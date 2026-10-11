import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import type { RippleMap, RippleNode } from '../types'
import { SENTRY_DEMO_MAP } from './demo'
import {
  MAPPING_MARKER,
  MAX_EDITS,
  REPORT_DESCRIPTION,
  REPORT_SCHEMA,
  SNIPPET_CHARS,
  checkPrompt,
  firstChangedLine,
  headerText,
  mappingPrompt,
  markUpdated,
  needsReview,
  plural,
  readPatch,
  relativeTo,
  reportText,
  sanitizeMap,
  slash,
  statusText,
  touchOf,
} from './model'
import { graphHtml, layoutTree, ringSvg, treeRows } from './render'
import type { Segment, TreeLine } from './render'

const PANE = 'ripple'
const USAGE = 'Ripple: /ripple maps recent edits · show · demo · web · reset'
/** When the mapping prompt is tried after it was asked for, in milliseconds. */
const SUBMIT_WAITS: readonly number[] = [120, 500, 1500]
/** A second ask this soon after the first, while it still maps, is a double press. */
const ASK_AGAIN_MS = 120_000

/** When mapping was last asked for; a reload forgets it, which lets a stuck one be asked again. */
let askedAt = 0

const edits = atom({ plugin: 'ripple', key: 'edits' } as const, [])
const map = atom({ plugin: 'ripple', key: 'map' } as const, null)
const mapping = atom({ plugin: 'ripple', key: 'mapping' } as const, false)

/** The elements both views draw with; every surface's table has them. */
type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the view's buttons do, bound to the render hook's `$`. */
type Actions = { check: (node: RippleNode) => void; remap: () => void; web: () => void }

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const storeKey = async ($: EngineInterface): Promise<string> =>
  `map:${slash(await $.session.root())}`

/** Keeps the last real map across sessions; the canned demo map is never kept. */
const persist = async ($: EngineInterface, value: RippleMap | null): Promise<void> => {
  try {
    if (value === null) await $.store.delete(await storeKey($))
    else if (value.isDemo !== true) await $.store.set(await storeKey($), value)
  } catch (error) {
    $.ui.log(`ripple: could not save the map: ${describe(error)}`, { to: 'debug' })
  }
}

const refreshStatus = async ($: EngineInterface): Promise<void> => {
  $.ui.status(statusText(await read($, edits), await read($, map), await read($, mapping)))
}

/** Rows the pane wants while it sits inline above the prompt. */
const paneRows = (held: RippleMap | null): number =>
  held === null ? 6 : Math.min(28, Math.max(8, held.nodes.length * 2 + 7))

/**
 * Opens (or retitles) the pane. Opened from a command or a press it is placed
 * at any width; opened from the report tool it may wait for a wider terminal,
 * and then a toast says how to bring it up.
 */
const openPane = async ($: EngineInterface): Promise<void> => {
  try {
    const opened = await $.ui.open({
      id: PANE,
      title: 'Ripple',
      columns: 64,
      rows: paneRows(await read($, map)),
    })
    if (!opened.isPlaced) $.ui.toast('Ripple: the map is ready. Run /ripple show to open it.')
  } catch (error) {
    $.ui.log(`ripple: could not open the pane: ${describe(error)}`, { to: 'debug' })
  }
}

const stopMapping = async ($: EngineInterface, why: string): Promise<void> => {
  await update($, mapping, () => false)
  await refreshStatus($)
  $.ui.toast(why)
}

/**
 * Submits the mapping prompt from a timer: after the first of `waits`, then
 * after each later one while the engine refuses it. It refuses a
 * `$.prompt.submit` made under a `command.run` hook (the prompt would wait on
 * the turn that hook holds), so the submit has to come once /ripple returned.
 */
const submitMapping = ($: EngineInterface, text: string, waits: readonly number[]): void => {
  const [wait, ...later] = waits
  if (wait === undefined) return
  $.clock.after(wait, () => {
    void $.prompt
      .submit({ text, asUser: true })
      .then(
        entered =>
          entered.drop === undefined
            ? undefined
            : stopMapping($, `Ripple: the mapping prompt was dropped (${entered.drop}).`),
        (error: unknown) =>
          later.length > 0
            ? submitMapping($, text, later)
            : stopMapping($, `Ripple: could not start mapping (${describe(error)}).`),
      )
      .catch((error: unknown) => $.ui.log(`ripple: mapping: ${describe(error)}`, { to: 'debug' }))
  })
}

/**
 * Asks Claude to map. The prompt is queued, never awaited: it starts a turn of
 * its own once the session is idle.
 */
const startMapping = async ($: EngineInterface, isRemap: boolean): Promise<void> => {
  const pending = await read($, edits)
  const held = await read($, map)
  const previous =
    isRemap && held !== null && held.isDemo !== true
      ? held.nodes.filter(node => node.kind === 'changed')
      : []
  if (pending.length === 0 && previous.length === 0) {
    $.ui.toast('Ripple: no edits to map yet.')
    return
  }
  const now = await $.clock.now()
  if ((await read($, mapping)) && now - askedAt < ASK_AGAIN_MS) {
    $.ui.toast('Ripple: already mapping.')
    return
  }
  askedAt = now
  await update($, mapping, () => true)
  $.ui.status(statusText(pending, held, true))
  $.ui.toast(
    pending.length > 0
      ? `Ripple: mapping ${plural(pending.length, 'edit')}…`
      : `Ripple: mapping ${plural(previous.length, 'change')} again…`,
  )
  submitMapping($, mappingPrompt(pending, previous), SUBMIT_WAITS)
}

const openInBrowser = async ($: EngineInterface, path: string): Promise<boolean> => {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const attempts = isWindows
    ? [['rundll32', 'url.dll,FileProtocolHandler', path.replace(/\//g, '\\')]]
    : [
        ['open', path],
        ['xdg-open', path],
      ]
  for (const argv of attempts) {
    try {
      const ran = await $.process.run(argv, { timeoutMs: 10_000 })
      if (ran.exitCode === 0) return true
    } catch {
      // Not on this machine: try the next opener.
    }
  }
  return false
}

const writeWeb = async ($: EngineInterface): Promise<void> => {
  const held = await read($, map)
  if (held === null) {
    $.ui.toast('Ripple: no map to export yet. Run /ripple first, or /ripple demo.')
    return
  }
  const path = `${slash(await $.session.root()).replace(/\/+$/, '')}/.ripple/graph.html`
  await $.fs.write(path, graphHtml(held))
  const isOpen = await openInBrowser($, path)
  $.ui.toast(isOpen ? 'Ripple: opened .ripple/graph.html' : `Ripple: wrote ${path}; open it in a browser.`)
}

const styleOf = (segment: Segment): Record<string, string | boolean> => {
  switch (segment.tone) {
    case 'changed':
      return { color: 'warning', ...(segment.isBold ? { bold: true } : {}) }
    case 'review':
      return { color: 'error', ...(segment.isBold ? { bold: true } : {}) }
    case 'updated':
      return { color: 'success' }
    case 'guide':
    case 'dim':
      return { dimColor: true }
    default:
      return {}
  }
}

const treeLine = ({ Text }: Kit, line: TreeLine): RenderElement => (
  <Text wrap="truncate-end">
    {line.segments
      .filter(segment => segment.text !== '')
      .map(segment => (
        <Text {...styleOf(segment)}>{segment.text}</Text>
      ))}
  </Text>
)

/** The tree says "untested" on the row; the rings say it with a dashed outline. */
const legend = ({ Box, Text }: Kit, isRings: boolean): RenderElement => (
  <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
    <Text color="warning">◉ changed</Text>
    <Text color="error">● needs review</Text>
    <Text color="success">✓ updated</Text>
    <Text>○ ok</Text>
    {isRings && <Text dimColor>dashed outline: untested</Text>}
    {isRings && <Text dimColor>inner ring: what it calls</Text>}
    {isRings && <Text color="magenta">purple halo: Sentry issues</Text>}
  </Box>
)

const buttons = ({ Box, Button }: Kit, held: RippleMap | null, actions: Actions): RenderElement => (
  <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
    {(held === null ? [] : needsReview(held)).slice(0, 9).map((node, index) => (
      <Button
        key={`check-${index + 1}`}
        label={`Check ${node.name}`}
        hotkey={String(index + 1)}
        plain
        onPress={() => actions.check(node)}
      />
    ))}
    <Button key="remap" label="Re-map" hotkey="r" plain onPress={() => actions.remap()} />
    {held !== null && (
      <Button key="web" label="Open in browser" hotkey="w" plain onPress={() => actions.web()} />
    )}
  </Box>
)

export const register: Register = on => {
  /** The turn the mapping prompt started, so its end without a map is noticed. */
  let mappingTurn: string | undefined
  /** The word the spinner shows this turn, drawn beside "Mapping…". */
  let spinnerWord = ''

  // 1. Track edits: let the edit run, then record it and turn reviewed callers green.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
      const text = e.tool === 'Edit' ? e.new_string : e.tool === 'Write' ? e.content : e.new_source
      const file = relativeTo(await $.session.root(), path)
      const hunks = readPatch(ran.result)
      const line = firstChangedLine(hunks)
      const at = await $.clock.now()
      await update($, edits, held =>
        [
          ...held,
          { file, snippet: text.slice(0, SNIPPET_CHARS), at, ...(line === undefined ? {} : { line }) },
        ].slice(-MAX_EDITS),
      )

      const touch = touchOf(file, text, hunks)
      const before = await read($, map)
      if (before !== null && markUpdated(before, touch).updated.length > 0) {
        const after = await update($, map, held =>
          held === null ? held : markUpdated(held, touch).map,
        )
        await persist($, after)
        if (after !== null && needsReview(after).length === 0) {
          $.ui.toast('Ripple: every flagged caller has been updated.')
        }
      }
      await refreshStatus($)
    } catch (error) {
      $.ui.log(`ripple: could not record an edit: ${describe(error)}`, { to: 'debug' })
    }
    return ran
  })

  // 2. Session start: the report tool, the last map, and (last) the command.
  on('session.start', async ($, e, next) => {
    try {
      await $.tool.register({
        name: 'report',
        description: REPORT_DESCRIPTION,
        inputSchema: REPORT_SCHEMA,
        isDeferred: false,
      })
      if ((await read($, map)) === null) {
        const kept = sanitizeMap(await $.store.get(await storeKey($)))
        if (!('error' in kept) && kept.map.nodes.length > 0) await update($, map, () => kept.map)
      }
      await refreshStatus($)
    } catch (error) {
      $.ui.log(`ripple: session start: ${describe(error)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: 'ripple',
        description: "Map what Claude's recent edits reach",
        argumentHint: '[show|demo|web|reset]',
      })
    } catch (error) {
      $.ui.log(`ripple: could not register /ripple: ${describe(error)}`, { to: 'debug' })
    }
    return next(e)
  })

  // 3. /ripple. Every branch returns {}: returned text would go to the transcript.
  on('command.run', { command: 'ripple' }, async ($, e) => {
    try {
      const verb = (typeof e.args === 'string' ? e.args : '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
      if (verb === '') {
        await startMapping($, false)
        if (await read($, mapping)) await openPane($)
      } else if (verb === 'show') {
        if ((await read($, map)) === null && !(await read($, mapping))) {
          $.ui.toast('Ripple: no map yet. Run /ripple after Claude edits something, or /ripple demo.')
        } else {
          await openPane($)
        }
      } else if (verb === 'demo') {
        await update($, mapping, () => false)
        await update($, map, () => SENTRY_DEMO_MAP)
        await refreshStatus($)
        await openPane($)
      } else if (verb === 'reset') {
        await update($, edits, () => [])
        await update($, map, () => null)
        await update($, mapping, () => false)
        await persist($, null)
        await refreshStatus($)
        await $.ui.close({ id: PANE }).catch(() => undefined)
        $.ui.toast('Ripple: cleared the edits and the map.')
      } else if (verb === 'web') {
        await writeWeb($)
      } else {
        $.ui.toast(USAGE)
      }
    } catch (error) {
      $.ui.toast(`Ripple: /ripple failed (${describe(error)}).`)
    }
    return {}
  })

  // 4. The report tool: save the map, show it, and tell Claude what to check.
  on('tool.call', { tool: 'mcp__ripple__report' }, async ($, e) => {
    const reported = sanitizeMap({ method: e.method, nodes: e.nodes, edges: e.edges })
    if ('error' in reported) {
      return {
        deny: `Ripple could not read the map: ${reported.error} Fix it and call mcp__ripple__report again.`,
      }
    }
    try {
      await update($, map, () => reported.map)
      await update($, edits, () => [])
      await update($, mapping, () => false)
      await persist($, reported.map)
      await refreshStatus($)
      void openPane($)
    } catch (error) {
      $.ui.log(`ripple: could not show the map: ${describe(error)}`, { to: 'debug' })
    }
    return { result: reportText(reported.map, reported.notes) }
  })

  // A mapping turn that ends with no report (interrupted, refused) stops the spinner.
  on('turn.start', ($, e, next) => {
    if (e.text.includes(MAPPING_MARKER)) mappingTurn = e.turnId
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.turnId === mappingTurn) {
      mappingTurn = undefined
      try {
        if (await read($, mapping)) {
          await stopMapping($, 'Ripple: mapping ended without a map. Run /ripple to try again.')
        }
      } catch (error) {
        $.ui.log(`ripple: turn end: ${describe(error)}`, { to: 'debug' })
      }
    }
    return done
  })

  // Reads the spinner's word as it passes, for the pane's "Mapping…" line.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    const word = typeof e.props.word === 'string' ? e.props.word : ''
    if (word !== spinnerWord) {
      spinnerWord = word
      if (mappingTurn !== undefined) $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // 5. Draw: the tree in a terminal, the rings wherever there is an Svg.
  on('ui.render', { component: 'Pane', requestId: 'ripple' }, async ($, e) => {
    const held = await read($, map)
    const isMapping = await read($, mapping)
    const pending = await read($, edits)
    const columns = Math.max(24, e.props.bodyColumns)

    const run = (work: Promise<void>): void => {
      void work.catch((error: unknown) => $.ui.toast(`Ripple: ${describe(error)}`))
    }
    const actions: Actions = {
      check: node => {
        if (held === null) return
        $.ui.toast(`Ripple: asked Claude to check ${node.name}.`)
        run($.prompt.submit({ text: checkPrompt(node, held), asUser: true }).then(() => undefined))
      },
      remap: () => run(startMapping($, true)),
      web: () => run(writeWeb($)),
    }

    const kit: Kit = $.ui.resolve(e)
    const { Box, Text } = kit
    const unmapped = `${plural(pending.length, 'edit')} ${held === null ? 'not mapped yet' : 'since this map'} · /ripple to map ${pending.length === 1 ? 'it' : 'them'}`
    const inSentry = held === null ? 0 : held.nodes.filter(node => node.sentry !== undefined).length
    const top = (
      <Box flexDirection="column">
        <Text bold>{held === null ? 'Ripple' : headerText(held)}</Text>
        {isMapping && (
          <Text color="warning">{`◌ Mapping…${spinnerWord === '' ? '' : ` ${spinnerWord}…`}`}</Text>
        )}
        {!isMapping && pending.length > 0 && <Text dimColor>{unmapped}</Text>}
        {inSentry > 0 && (
          <Text color="magenta">{`Sentry: ${plural(inSentry, 'function')} here already failing in production`}</Text>
        )}
      </Box>
    )
    const empty = held === null && !isMapping && pending.length === 0 && (
      <Text dimColor>No map yet. Run /ripple after Claude edits something, or /ripple demo.</Text>
    )
    const nothing = held !== null && held.nodes.length === 0 && (
      <Text dimColor>The last edits changed no function.</Text>
    )

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          {top}
          {held !== null && held.nodes.length > 0 && legend(kit, false)}
          {empty}
          {nothing}
          {held !== null && held.nodes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {layoutTree(treeRows(held), columns).map(line => treeLine(kit, line))}
            </Box>
          )}
          {buttons(kit, held, actions)}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const side = Math.round(Math.min(720, Math.max(300, columns * 8)))
    return (
      <Box flexDirection="column" gap={1}>
        {top}
        {empty}
        {nothing}
        {held !== null && held.nodes.length > 0 && (
          <Svg source={ringSvg(held)} alt={headerText(held)} width={side} height={side} isInteractive />
        )}
        {held !== null && held.nodes.length > 0 && legend(kit, true)}
        {buttons(kit, held, actions)}
      </Box>
    )
  })
}
