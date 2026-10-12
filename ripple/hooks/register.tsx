import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement, TextProps } from 'claude-code'

import type { RippleMap, RippleMode, RippleScope } from '../types'
import {
  DEFAULT_BRANCH_COMMANDS,
  HEAD,
  UNTRACKED_COMMAND,
  describeChanges,
  diffCommand,
  mergeBaseCommand,
  readChanges,
  readRequest,
} from './changes'
import type { Base, Changes } from './changes'
import { COLORS, LEGEND } from './draw'
import type { Paint } from './draw'
import {
  REPORT_DESCRIPTION,
  REPORT_SCHEMA,
  REPORT_TOOL,
  headerText,
  originText,
  readReport,
  readStored,
  statusText,
} from './map'
import {
  MAPPER_DESCRIPTION,
  MAPPER_NAME,
  MAPPER_PROMPT,
  MAPPER_TOOLS,
  MAPPER_TYPE,
  NO_ASKING,
  askPrompt,
  reportReply,
  taskPrompt,
} from './mapper'
import { MOVES, detailOf, drawView, modeIn, nextFlagged, planOf, selectedOf, stepped } from './view'
import { graphHtml, ringSvg } from './web'

const PANE = 'ripple'
/** The columns the pane asks for when it is docked beside the transcript. */
const PANE_COLUMNS = 76
const NOT_A_REPOSITORY = 'Ripple: this is not a git repository, so there are no changes to map.'
const NO_DEFAULT_BRANCH =
  'Ripple: found no default branch to compare this one with (looked for origin/HEAD, main, and master). Run /ripple to map the uncommitted changes.'

const map = atom({ plugin: 'ripple', key: 'map' } as const, null)
const mapping = atom({ plugin: 'ripple', key: 'mapping' } as const, null)
const view = atom({ plugin: 'ripple', key: 'view' } as const, { mode: null, selected: null })

/** The view the map opens in until the person switches: the plugin's `view` option. */
let firstMode: RippleMode = 'graph'
/** The view the pane last drew the map in: the tree, wherever the graph had no room. */
let drawnMode: RippleMode = 'graph'

/** Whether the changes have moved on since the map on hand was made, as last checked. */
let isStale = false

/** The elements both views draw with; every surface's table has them. */
type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const storeKey = async ($: EngineInterface): Promise<string> => `map:${await $.session.root()}`

/** Keeps the last map across sessions. */
const persist = async ($: EngineInterface, value: RippleMap | null): Promise<void> => {
  try {
    if (value === null) await $.store.delete(await storeKey($))
    else await $.store.set(await storeKey($), value)
  } catch (error) {
    $.ui.log(`ripple: could not save the map: ${describe(error)}`, { to: 'debug' })
  }
}

/** A command's output under the session's root, or undefined when it failed. */
const run = async ($: EngineInterface, argv: readonly string[]): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(argv, { cwd: await $.session.root(), timeoutMs: 20_000 })
    return ran.exitCode === 0 ? ran.stdout : undefined
  } catch {
    return undefined
  }
}

/** What a scope's changes are against: HEAD, or where this branch left the default one. */
const baseOf = async ($: EngineInterface, scope: RippleScope): Promise<Base | undefined> => {
  if (scope === 'uncommitted') return HEAD
  for (const command of DEFAULT_BRANCH_COMMANDS) {
    const branch = (await run($, command))?.trim() ?? ''
    if (branch === '') continue
    const ref = (await run($, mergeBaseCommand(branch)))?.trim() ?? ''
    if (ref !== '') return { ref, name: branch.replace(/^origin\//, '') }
  }
  return undefined
}

/** Reads a scope's changes from git, or says why there are none to read. */
const readTree = async ($: EngineInterface, scope: RippleScope): Promise<Changes | string> => {
  if ((await $.session.repo()) === null) return NOT_A_REPOSITORY
  const base = await baseOf($, scope)
  if (base === undefined) return NO_DEFAULT_BRANCH
  const diff = (await run($, diffCommand(base.ref))) ?? ''
  const untracked = (await run($, UNTRACKED_COMMAND)) ?? ''
  return readChanges(scope, base, diff, untracked)
}

const nothingToMap = (changes: Changes): string =>
  changes.scope === 'branch'
    ? `Ripple: nothing to map. This branch has no changes since ${changes.base.name}.`
    : 'Ripple: nothing to map. Git shows no uncommitted changes here. Change something, or run /ripple branch to map the whole branch.'

const refreshStatus = async ($: EngineInterface): Promise<void> => {
  $.ui.status(statusText(await read($, map), (await read($, mapping)) !== null))
}

/**
 * Opens the pane. Opened from a command or a press it is placed at any width;
 * opened when a report arrives it may wait for a wider terminal, and then a
 * toast says how to bring it up.
 */
const openPane = async ($: EngineInterface): Promise<void> => {
  try {
    const opened = await $.ui.open({ id: PANE, title: 'Ripple', columns: PANE_COLUMNS, focus: true })
    if (!opened.isPlaced) $.ui.toast('Ripple: the map is ready. Run /ripple to open it.')
  } catch (error) {
    $.ui.log(`ripple: could not open the pane: ${describe(error)}`, { to: 'debug' })
  }
}

/** Whether the mapper Ripple started is still at work; one that ended without a word is forgotten. */
const isMapping = async ($: EngineInterface): Promise<boolean> => {
  const at = await read($, mapping)
  if (at === null) return false
  const agent = (await $.agent.list()).find(one => one.id === at.agentId)
  if (agent !== undefined && ['pending', 'running', 'waiting'].includes(agent.status)) return true
  await update($, mapping, () => null)
  return false
}

const stopMapping = async ($: EngineInterface, why: string): Promise<void> => {
  await update($, mapping, () => null)
  await refreshStatus($)
  $.ui.toast(why)
}

/**
 * Shows the map of a scope's changes: the one on hand when it was made from
 * these very changes with this focus, else a mapper is started (and always
 * when `isForced`). Resolves to why there is nothing to show, for the caller
 * to say.
 */
const showMap = async (
  $: EngineInterface,
  scope: RippleScope,
  focus: string,
  isForced: boolean,
): Promise<string | undefined> => {
  const changes = await readTree($, scope)
  if (typeof changes === 'string') return changes
  if (changes.files.length === 0) return nothingToMap(changes)
  const held = await read($, map)
  if (!isForced && held !== null && held.print === changes.print && held.focus === focus) {
    isStale = false
    return undefined
  }
  if (await isMapping($)) return undefined
  const spawned = await $.agent.spawn({
    subagentType: MAPPER_TYPE,
    description: `Map ${describeChanges(changes)}`,
    prompt: taskPrompt(changes, focus),
  })
  if (spawned.agentId === undefined) {
    return `Ripple: could not start the mapper (${spawned.deny ?? 'no agent started'}).`
  }
  const { agentId } = spawned
  await update($, mapping, () => ({
    agentId,
    scope,
    base: changes.base.name,
    focus,
    print: changes.print,
  }))
  await refreshStatus($)
  return undefined
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
  const root = (await $.session.root()).replace(/\\/g, '/').replace(/\/+$/, '')
  const path = `${root}/.ripple/graph.html`
  await $.fs.write(path, graphHtml(held))
  const isOpen = await openInBrowser($, path)
  return isOpen ? 'Ripple: opened .ripple/graph.html' : `Ripple: wrote ${path}; open it in a browser.`
}

const styleOf = (paint: Paint): TextProps => {
  const color = COLORS[paint]
  return { ...(color === undefined ? {} : { color }), ...(paint === 'dim' ? { dimColor: true } : {}) }
}

const legend = ({ Box, Text }: Kit): RenderElement => (
  <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
    {LEGEND.map(mark => (
      <Text {...styleOf(mark.paint)}>{`${mark.glyph} ${mark.label}`}</Text>
    ))}
  </Box>
)

/** What the person is looking at, the view's mode settled. */
const readView = async ($: EngineInterface): Promise<{ mode: RippleMode; selected: string | null }> => {
  const seen = await read($, view)
  return { mode: seen.mode ?? firstMode, selected: seen.selected }
}

/** Asks Claude, in the conversation, about the selected node. */
const ask = async ($: EngineInterface): Promise<void> => {
  const held = await read($, map)
  const node = held === null ? undefined : selectedOf(held, (await read($, view)).selected)
  if (held === null || node === undefined) return
  $.ui.toast(`Ripple: asked Claude about ${node.name}.`)
  await $.prompt.submit({ text: askPrompt(node, held), asUser: true })
}

/** Does what one key of the pane does: a Button's hotkey, or a key the map was handed. */
const press = async ($: EngineInterface, key: string): Promise<void> => {
  try {
    const held = await read($, map)
    if (held === null) return
    const { mode } = await readView($)
    const move = MOVES[key]
    if (move !== undefined) {
      await update($, view, at => ({ ...at, selected: stepped(held, drawnMode, at.selected, move) }))
    } else if (key === 'n') {
      await update($, view, at => ({ ...at, selected: nextFlagged(held, at.selected) }))
    } else if (key === 't') {
      const other: RippleMode = mode === 'tree' ? 'graph' : 'tree'
      await update($, view, at => ({ ...at, mode: other }))
    } else if (key === 'a') {
      await ask($)
    } else if (key === 'r' || key === 'w') {
      const said = key === 'w' ? await writeWeb($) : await showMap($, held.scope, held.focus, true)
      if (said !== undefined) $.ui.toast(said)
    }
  } catch (error) {
    $.ui.toast(`Ripple: ${describe(error)}`)
  }
}

export const register: Register = (on, options) => {
  firstMode = options.view === 'tree' ? 'tree' : 'graph'

  on('session.start', async ($, e, next) => {
    try {
      await $.tool.register({
        name: 'report',
        description: REPORT_DESCRIPTION,
        inputSchema: REPORT_SCHEMA,
        isDeferred: true,
      })
      await $.agent.register({
        name: MAPPER_NAME,
        description: MAPPER_DESCRIPTION,
        prompt: MAPPER_PROMPT,
        tools: MAPPER_TOOLS,
        background: true,
      })
      await $.command.register({
        name: 'ripple',
        description: 'Map what your changes reach',
        argumentHint: '[branch] [focus] | web | reset',
      })
      if ((await read($, map)) === null) {
        const kept = readStored(await $.store.get(await storeKey($)))
        if (kept !== null) await update($, map, () => kept)
      }
      await refreshStatus($)
    } catch (error) {
      $.ui.log(`ripple: session start: ${describe(error)}`, { to: 'debug' })
    }
    return next(e)
  })

  // The mapper is Ripple's to start, never the model's to pick.
  on('agent.offer', { agent: 'ripple:mapper' }, () => ({ isOffered: false })).catch(($, e, next) => next(e))

  // A command that opens the pane answers nothing; one with nothing to show
  // says why, since a command that only toasts looks dead.
  on('command.run', { command: 'ripple' }, async ($, e) => {
    let said: string | undefined
    try {
      const request = readRequest(e.args)
      if (request.verb === 'map') {
        said = await showMap($, request.scope, request.focus, false)
        if (said === undefined) await openPane($)
      } else if (request.verb === 'web') {
        said = await writeWeb($)
      } else {
        await update($, map, () => null)
        await update($, mapping, () => null)
        isStale = false
        await persist($, null)
        await refreshStatus($)
        await $.ui.close({ id: PANE }).catch(() => undefined)
        said = 'Ripple: cleared the map.'
      }
    } catch (error) {
      said = `Ripple: /ripple failed (${describe(error)}).`
    }
    return said === undefined ? {} : { text: said }
  })

  // The mapper never asks: what would have raised a permission dialog is
  // refused instead, and it finds another way.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.agentId === undefined || verdict.decision !== 'ask') return verdict
    const at = await read($, mapping)
    return at?.agentId === e.agentId ? { decision: 'deny', reason: NO_ASKING } : verdict
  }).catch(($, e, next) => next(e))

  // The report: only the mapper Ripple started may make it. It becomes the
  // map of the changes that mapper was sent to read.
  on('tool.call', { tool: 'mcp__ripple__report' }, async ($, e) => {
    const at = await read($, mapping)
    if (at === null || e.agentId !== at.agentId) {
      return { deny: 'Only the mapper Ripple starts reports a map. The person runs /ripple to start one.' }
    }
    const reported = readReport(e)
    if ('error' in reported) {
      return { deny: `Ripple could not read the map: ${reported.error} Fix it and call ${REPORT_TOOL} again.` }
    }
    const made: RippleMap = {
      ...reported.report,
      scope: at.scope,
      base: at.base,
      focus: at.focus,
      print: at.print,
    }
    await update($, map, () => made)
    await update($, mapping, () => null)
    await update($, view, seen => ({ ...seen, selected: null }))
    isStale = false
    await persist($, made)
    await refreshStatus($)
    void openPane($)
    return { result: reportReply(reported.report, reported.notes) }
  }).catch(() => ({ deny: 'Ripple failed while reading the report.' }))

  // A mapper that ends with no report stops the wait. After the person's own
  // turns, the changes are read again to say when they have left the map behind.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    try {
      if (e.agentId !== undefined) {
        const at = await read($, mapping)
        if (at?.agentId === e.agentId) {
          await stopMapping($, 'Ripple: the mapper ended without a map. Run /ripple to try again.')
        }
        return done
      }
      const held = await read($, map)
      if (held === null) return done
      const changes = await readTree($, held.scope)
      const hasMoved = typeof changes === 'string' || changes.print !== held.print
      if (hasMoved !== isStale) {
        isStale = hasMoved
        $.ui.invalidate('ui.render')
      }
    } catch (error) {
      $.ui.log(`ripple: turn end: ${describe(error)}`, { to: 'debug' })
    }
    return done
  })

  // What the map posts: the node a click landed on, or a key pressed over it.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || typeof e.data !== 'object' || e.data === null) return next(e)
    const { select, key } = e.data as { select?: unknown; key?: unknown }
    if (typeof select === 'string') await update($, view, at => ({ ...at, selected: select }))
    else if (typeof key === 'string') await press($, key)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: 'ripple' }, async ($, e) => {
    const held = await read($, map)
    const at = await read($, mapping)
    const { mode, selected } = await readView($)
    const columns = Math.max(24, e.props.bodyColumns)

    const kit: Kit = $.ui.resolve(e)
    const { Box, Text, Button } = kit
    const hasNodes = held !== null && held.nodes.length > 0
    const notice =
      at !== null
        ? '◌ Mapping…'
        : held === null
          ? 'No map yet. Run /ripple to map your changes.'
          : isStale
            ? 'The changes have moved on since this map · /ripple to map them again'
            : undefined
    const noticeLine = notice !== undefined && (
      <Text wrap="truncate-end" {...(at === null ? { dimColor: true } : { color: 'warning' })}>
        {notice}
      </Text>
    )
    const key = (hotkey: string, label: string, isDim = false): RenderElement => (
      <Button
        key={hotkey}
        label={label}
        hotkey={hotkey}
        plain
        {...(isDim ? { dimColor: true } : {})}
        onPress={() => void press($, hotkey)}
      />
    )

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const side = Math.round(Math.min(720, Math.max(300, columns * 8)))
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>{held === null ? 'Ripple' : headerText(held)}</Text>
            {held !== null && <Text dimColor>{originText(held)}</Text>}
            {held?.summary !== undefined && <Text wrap="wrap">{held.summary}</Text>}
            {noticeLine}
          </Box>
          {hasNodes && (
            <Svg source={ringSvg(held)} alt={headerText(held)} width={side} height={side} isInteractive />
          )}
          {hasNodes && legend(kit)}
          {held !== null && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {key('r', 'Re-map')}
              {key('w', 'Open in browser')}
            </Box>
          )}
        </Box>
      )
    }

    const { Client, Link } = $.ui.resolve(e)
    const node = hasNodes ? selectedOf(held, selected) : undefined
    const detail = node === undefined || !hasNodes ? undefined : detailOf(held, node)
    const root = (await $.session.root()).replace(/\\/g, '/').replace(/\/+$/, '')
    const plan = planOf(
      { columns, rows: e.props.scroll.bodyRows },
      {
        summary: held?.summary ?? '',
        verdict: detail?.verdict?.text ?? '',
        links: detail?.links ?? '',
        hasNotice: notice !== undefined,
      },
    )
    const room = { columns, rows: plan.mapRows }
    const gap = plan.isCompact ? 0 : 1
    drawnMode = modeIn(mode, room)
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {held === null ? 'Ripple' : headerText(held)}
        </Text>
        {!plan.isCompact && held !== null && <Text dimColor>{originText(held)}</Text>}
        {!plan.isCompact && held?.summary !== undefined && <Text wrap="wrap">{held.summary}</Text>}
        {noticeLine}
        {!plan.isCompact && hasNodes && legend(kit)}
        {hasNodes && (
          <Box marginTop={gap}>
            <Client key="map" module="./pane.tsx" props={drawView(held, mode, selected, room)} />
          </Box>
        )}
        {detail !== undefined && node !== undefined && (
          <Box flexDirection="column" marginTop={gap}>
            <Text wrap="truncate-end">
              <Text bold>{`▸ ${detail.name}`}</Text>
              <Text dimColor>{` · ${detail.facts} · `}</Text>
              <Link href={`file://${root}/${node.file}`} label={detail.where} />
            </Text>
            {detail.verdict !== undefined && (
              <Text wrap={plan.isCompact ? 'truncate-end' : 'wrap'} {...styleOf(detail.verdict.paint)}>
                {detail.verdict.text}
              </Text>
            )}
            {!plan.isCompact && detail.links !== '' && (
              <Text wrap="wrap" dimColor>
                {detail.links}
              </Text>
            )}
          </Box>
        )}
        {hasNodes && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={gap}>
            {key('h', '←', true)}
            {key('j', '↓', true)}
            {key('k', '↑', true)}
            {key('l', '→', true)}
            {key('n', 'next flagged', true)}
            {key('a', 'ask Claude')}
            {modeIn('graph', room) === 'graph' && key('t', drawnMode === 'tree' ? 'graph view' : 'tree view')}
            {key('r', 're-map')}
            {key('w', 'web page')}
          </Box>
        )}
      </Box>
    )
  })
}
