import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import type { RippleEdit, RippleMap, RippleNode } from '../types'
import {
  MAPPING_MARKER,
  REPORT_DESCRIPTION,
  REPORT_SCHEMA,
  checkPrompt,
  fileCount,
  headerText,
  hunkKey,
  mappingPrompt,
  markUpdated,
  needsReview,
  newFileHunks,
  parseDiff,
  plural,
  printOf,
  readStored,
  reportText,
  sanitizeMap,
  slash,
  statusText,
  touchOf,
} from './model'
import { graphHtml, layoutTree, ringSvg, treeRows } from './render'
import type { Segment, TreeLine } from './render'

// Ripple maps the working tree's uncommitted changes, read from git. It does
// not watch Claude's tools: a change is a change however it was made (an Edit,
// a `sed` in the shell, your own typing), and `git diff HEAD` has them all.

const PANE = 'ripple'
const USAGE = 'Ripple: /ripple maps your uncommitted changes · /ripple web · reset'
const NO_CHANGES =
  'Ripple: nothing to map. Git shows no uncommitted changes here. Change something (or ask Claude to), then run /ripple.'
/** When the mapping prompt is tried after it was asked for, in milliseconds. */
const SUBMIT_WAITS: readonly number[] = [120, 500, 1500]
/** A second ask this soon after the first, while it still maps, is a double press. */
const ASK_AGAIN_MS = 120_000

/** When mapping was last asked for; a reload forgets it, which lets a stuck one be asked again. */
let askedAt = 0
/** The working tree against HEAD, as git last said: one entry per hunk, and a print of it all. */
let tree: { hunks: RippleEdit[]; print: string } = { hunks: [], print: '' }
/**
 * The hunks the tree held when the map was made, by key. A hunk that is not
 * among them came after the map: that is how a fix is told from the change.
 */
let mappedHunks: Set<string> | undefined

const map = atom({ plugin: 'ripple', key: 'map' } as const, null)
const mapping = atom({ plugin: 'ripple', key: 'mapping' } as const, false)

/** The elements both views draw with; every surface's table has them. */
type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the view's buttons do, bound to the render hook's `$`. */
type Actions = { check: (node: RippleNode) => void; remap: () => void; web: () => void }

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const storeKey = async ($: EngineInterface): Promise<string> =>
  `map:${slash(await $.session.root())}`

/** Keeps the last map across sessions. */
const persist = async ($: EngineInterface, value: RippleMap | null): Promise<void> => {
  try {
    if (value === null) await $.store.delete(await storeKey($))
    else await $.store.set(await storeKey($), value)
  } catch (error) {
    $.ui.log(`ripple: could not save the map: ${describe(error)}`, { to: 'debug' })
  }
}

/** One read-only git command under the session's root; its output, or '' when it fails. */
const git = async ($: EngineInterface, args: readonly string[]): Promise<string> => {
  try {
    const ran = await $.process.run(['git', ...args], { cwd: await $.session.root(), timeoutMs: 20_000 })
    return ran.exitCode === 0 ? ran.stdout : ''
  } catch {
    return ''
  }
}

/** Reads the uncommitted changes: the diff against HEAD, and the files git does not track yet. */
const readTree = async ($: EngineInterface): Promise<void> => {
  const diff = await git($, ['diff', 'HEAD', '--relative', '--unified=0', '--no-color', '--no-ext-diff'])
  const fresh = await git($, ['ls-files', '--others', '--exclude-standard'])
  const at = await $.clock.now()
  const hunks = [...parseDiff(diff, at), ...newFileHunks(fresh, at)]
  tree = { hunks, print: hunks.length === 0 ? '' : printOf(`${diff}\n${fresh}`) }
}

/** How many files hold changes the map on hand was not made from. */
const unmappedFiles = (held: RippleMap | null): number =>
  held !== null && held.print === tree.print ? 0 : fileCount(tree.hunks)

const refreshStatus = async ($: EngineInterface): Promise<void> => {
  const held = await read($, map)
  $.ui.status(statusText(held, await read($, mapping), unmappedFiles(held)))
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
    if (!opened.isPlaced) $.ui.toast('Ripple: the map is ready. Run /ripple to open it.')
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
 * /ripple: shows the map of the uncommitted changes. The map on hand is shown
 * as it is when it was made from this very diff; else Claude is asked to map
 * (one model turn), and `isForced` asks even then. The prompt is queued, never
 * awaited. Resolves to why there is nothing to show, for the caller to say.
 */
const showMap = async ($: EngineInterface, isForced: boolean): Promise<string | undefined> => {
  await readTree($)
  await refreshStatus($)
  if (tree.hunks.length === 0) return NO_CHANGES
  const held = await read($, map)
  if (!isForced && held !== null && held.print === tree.print) return undefined
  const now = await $.clock.now()
  if ((await read($, mapping)) && now - askedAt < ASK_AGAIN_MS) return 'Ripple: already mapping.'
  askedAt = now
  await update($, mapping, () => true)
  $.ui.status(statusText(held, true, 0))
  $.ui.toast(`Ripple: mapping uncommitted changes in ${plural(fileCount(tree.hunks), 'file')}…`)
  submitMapping($, mappingPrompt(tree.hunks), SUBMIT_WAITS)
  return undefined
}

/**
 * Turns flagged callers green from the diff alone: a hunk the tree did not
 * hold when the map was made is a change that came after it, and one that
 * lands on a caller that needs review is taken as its fix.
 */
const markFixes = async ($: EngineInterface): Promise<void> => {
  const held = await read($, map)
  if (held === null || mappedHunks === undefined) return
  const known = mappedHunks
  const later = tree.hunks.filter(hunk => !known.has(hunkKey(hunk)))
  if (later.length === 0) return
  for (const hunk of later) known.add(hunkKey(hunk))
  const turned = later.reduce((current, hunk) => markUpdated(current, touchOf(hunk)).map, held)
  if (turned === held) return
  const after = await update($, map, () => turned)
  await persist($, after)
  if (after !== null && needsReview(after).length === 0) {
    $.ui.toast('Ripple: every flagged caller has been updated.')
  }
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

/** Writes and opens the web page; resolves to what happened, for the caller to say. */
const writeWeb = async ($: EngineInterface): Promise<string> => {
  const held = await read($, map)
  if (held === null) return 'Ripple: no map to export yet. Run /ripple first.'
  const path = `${slash(await $.session.root()).replace(/\/+$/, '')}/.ripple/graph.html`
  await $.fs.write(path, graphHtml(held))
  const isOpen = await openInBrowser($, path)
  return isOpen ? 'Ripple: opened .ripple/graph.html' : `Ripple: wrote ${path}; open it in a browser.`
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

  // 1. Session start: the report tool, the last map, the tree, and (last) the command.
  on('session.start', async ($, e, next) => {
    try {
      await $.tool.register({
        name: 'report',
        description: REPORT_DESCRIPTION,
        inputSchema: REPORT_SCHEMA,
        isDeferred: false,
      })
      if ((await read($, map)) === null) {
        const kept = readStored(await $.store.get(await storeKey($)))
        if (kept !== null) await update($, map, () => kept)
      }
      await readTree($)
      await refreshStatus($)
    } catch (error) {
      $.ui.log(`ripple: session start: ${describe(error)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: 'ripple',
        description: 'Map what your uncommitted changes reach',
        argumentHint: '[web|reset]',
      })
    } catch (error) {
      $.ui.log(`ripple: could not register /ripple: ${describe(error)}`, { to: 'debug' })
    }
    return next(e)
  })

  // 2. /ripple. A branch that opens the pane returns {}; one with nothing to
  // show prints why, since a command that answers with a toast alone looks dead.
  on('command.run', { command: 'ripple' }, async ($, e) => {
    let said: string | undefined
    try {
      const verb = (typeof e.args === 'string' ? e.args : '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
      if (verb === '') {
        said = await showMap($, false)
        if (said === undefined) await openPane($)
      } else if (verb === 'reset') {
        await update($, map, () => null)
        await update($, mapping, () => false)
        mappedHunks = undefined
        await persist($, null)
        await readTree($)
        await refreshStatus($)
        await $.ui.close({ id: PANE }).catch(() => undefined)
        said = 'Ripple: cleared the map.'
      } else if (verb === 'web') {
        said = await writeWeb($)
      } else {
        said = USAGE
      }
    } catch (error) {
      said = `Ripple: /ripple failed (${describe(error)}).`
    }
    return said === undefined ? {} : { text: said }
  })

  // 3. The report tool: save the map, show it, and tell Claude what to check.
  on('tool.call', { tool: 'mcp__ripple__report' }, async ($, e) => {
    const reported = sanitizeMap({ method: e.method, nodes: e.nodes, edges: e.edges })
    if ('error' in reported) {
      return {
        deny: `Ripple could not read the map: ${reported.error} Fix it and call mcp__ripple__report again.`,
      }
    }
    try {
      // The map is of the tree as it stands now: remember that diff and its hunks.
      await readTree($)
      mappedHunks = new Set(tree.hunks.map(hunkKey))
      const made: RippleMap = { ...reported.map, print: tree.print }
      await update($, map, () => made)
      await update($, mapping, () => false)
      await persist($, made)
      await refreshStatus($)
      void openPane($)
    } catch (error) {
      $.ui.log(`ripple: could not show the map: ${describe(error)}`, { to: 'debug' })
    }
    return { result: reportText(reported.map, reported.notes) }
  })

  on('turn.start', ($, e, next) => {
    if (e.text.includes(MAPPING_MARKER)) mappingTurn = e.turnId
    return next(e)
  })

  // 4. After every turn: look at the tree again. A mapping turn that ended with
  // no report stops the spinner; changes made since the map turn callers green.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    try {
      if (e.turnId === mappingTurn) {
        mappingTurn = undefined
        if (await read($, mapping)) {
          await stopMapping($, 'Ripple: mapping ended without a map. Run /ripple to try again.')
        }
      }
      const before = tree.print
      await readTree($)
      await markFixes($)
      await refreshStatus($)
      // The pane says when the tree has moved past its map, which no state write tells it.
      if (tree.print !== before) $.ui.invalidate('ui.render')
    } catch (error) {
      $.ui.log(`ripple: turn end: ${describe(error)}`, { to: 'debug' })
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
    const columns = Math.max(24, e.props.bodyColumns)
    const isStale = held !== null && unmappedFiles(held) > 0

    const run = (work: Promise<void>): void => {
      void work.catch((error: unknown) => $.ui.toast(`Ripple: ${describe(error)}`))
    }
    const actions: Actions = {
      check: node => {
        if (held === null) return
        $.ui.toast(`Ripple: asked Claude to check ${node.name}.`)
        run($.prompt.submit({ text: checkPrompt(node, held), asUser: true }).then(() => undefined))
      },
      remap: () =>
        run(
          showMap($, true).then(said => {
            if (said !== undefined) $.ui.toast(said)
          }),
        ),
      web: () => run(writeWeb($).then(said => $.ui.toast(said))),
    }

    const kit: Kit = $.ui.resolve(e)
    const { Box, Text } = kit
    const top = (
      <Box flexDirection="column">
        <Text bold>{held === null ? 'Ripple' : headerText(held)}</Text>
        {isMapping && (
          <Text color="warning">{`◌ Mapping…${spinnerWord === '' ? '' : ` ${spinnerWord}…`}`}</Text>
        )}
        {!isMapping && isStale && (
          <Text dimColor>The working tree has changed since this map · /ripple to map it again</Text>
        )}
      </Box>
    )
    const empty = held === null && !isMapping && (
      <Text dimColor>No map yet. Run /ripple to map your uncommitted changes.</Text>
    )
    const nothing = held !== null && held.nodes.length === 0 && (
      <Text dimColor>The changes touched no function.</Text>
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
