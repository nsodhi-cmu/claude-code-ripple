import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement, TextProps } from 'claude-code'

import type { RippleMap, RippleMode, RippleScope } from '../types'
import {
  DEFAULT_BRANCH_COMMANDS,
  HEAD,
  UNTRACKED_COMMAND,
  describeChanges,
  diffCommand,
  hashCommand,
  mergeBaseCommand,
  readChanges,
  readRequest,
} from './changes'
import type { Base, Changes } from './changes'
import { COLORS, LEGEND, clipStart, markOf } from './draw'
import type { Paint, Pan, Room } from './draw'
import { fileOf, filesOf } from './files'
import { drawList, listSays, scrollList, showInList, stepInList } from './list'
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
import { LIST_MOVES, MOVES, factsOf, modeIn, nextFlagged, planOf, selectedOf, viewsOf } from './view'
import { ringSvg } from './rings'

const PANE = 'ripple'
/** A room tall enough to draw any map whole, which is how the rows a map needs are counted. */
const WHOLE_ROWS = 1000
const ORIGIN: Pan = { x: 0, y: 0 }
/** What the line over the list holds beside the path and the count: its mark, two dots with their spaces, and the link. */
const OVER_LIST_CHARS = '▸ '.length + 2 * ' · '.length + 'open'.length
/** The columns the pane asks for when it is docked beside the transcript, and the fewest it draws in. */
const PANE_COLUMNS = 76
const MIN_COLUMNS = 24
/** The ring picture's side on the surfaces that draw it, in pixels: the pane's width, within these. */
const RING_PIXELS = { perColumn: 8, least: 300, most: 720 }
/** How long a git command may run, in milliseconds. */
const GIT_TIMEOUT_MS = 20_000
/**
 * The keys that start something: a turn of the conversation, and a mapper.
 * They are digits, which the first letter of a typed prompt never is.
 */
const ASK = '1'
const REMAP = '2'

const NOT_A_REPOSITORY = 'Ripple: this is not a git repository, so there are no changes to map.'
const NO_DEFAULT_BRANCH =
  'Ripple: found no default branch to compare this one with (looked for origin/HEAD, main, and master). Run /ripple to map the uncommitted changes.'
const GIT_FAILED =
  'Ripple: git could not show the changes. A repository with no commits yet has nothing to compare them with.'

const map = atom({ plugin: 'ripple', key: 'map' } as const, null)
const mapping = atom({ plugin: 'ripple', key: 'mapping' } as const, null)
const view = atom({ plugin: 'ripple', key: 'view' } as const, { mode: null, selected: null, pan: null, top: null })

/** The view the map opens in until the person switches: the plugin's `view` option. */
let firstMode: RippleMode = 'graph'
/** The views of the map, the graph scrolling as the plugin's `scroll` option says. */
let views = viewsOf('pinned')
/**
 * What the pane last drew, which a key or a turn of the wheel goes on from:
 * the view it drew the map in (the tree, wherever the graph had no room), the
 * room it gave the map and where the map's window stood, the rows it gave the
 * list and the symbol the list started from, and the row of the pane's body
 * the list begins on.
 */
let shown: { mode: RippleMode; room: Room; pan: Pan; listRows: number; top: number; listAt: number } = {
  mode: 'graph',
  room: { columns: 0, rows: 0 },
  pan: { x: 0, y: 0 },
  listRows: 1,
  top: 0,
  listAt: 0,
}
/** Whether the changes have moved on since the map on hand was made, as last checked. */
let isStale = false
/** Whether a mapper is being started, between the check that none is at work and the record of the new one. */
let isStarting = false

/** The elements every surface's table has. */
type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const rootOf = async ($: EngineInterface): Promise<string> =>
  (await $.session.root()).replace(/\\/g, '/').replace(/\/+$/, '')

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
    const ran = await $.process.run(argv, { cwd: await $.session.root(), timeoutMs: GIT_TIMEOUT_MS })
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

/** Reads a scope's changes from git, or says why they could not be read. */
const readTree = async ($: EngineInterface, scope: RippleScope): Promise<Changes | string> => {
  if ((await $.session.repo()) === null) return NOT_A_REPOSITORY
  const base = await baseOf($, scope)
  if (base === undefined) return NO_DEFAULT_BRANCH
  const diff = await run($, diffCommand(base.ref))
  const untracked = await run($, UNTRACKED_COMMAND)
  if (diff === undefined || untracked === undefined) return GIT_FAILED
  const hashing = hashCommand(untracked)
  const hashes = hashing === undefined ? '' : ((await run($, hashing)) ?? '')
  return readChanges(scope, base, diff, untracked, hashes)
}

const nothingToMap = (changes: Changes): string =>
  changes.scope === 'branch'
    ? `Ripple: nothing to map. This branch has no changes since ${changes.base.name}.`
    : 'Ripple: nothing to map. Git shows no uncommitted changes here. Change something, or run /ripple branch to map the whole branch.'

const refreshStatus = async ($: EngineInterface): Promise<void> => {
  $.ui.status(statusText(await read($, map), (await read($, mapping)) !== null, isStale))
}

/**
 * Reads the changes of the map on hand again and notes whether they are
 * still the ones it was made from. A reading that fails changes nothing.
 */
const checkStale = async ($: EngineInterface): Promise<void> => {
  const held = await read($, map)
  if (held === null) return
  const changes = await readTree($, held.scope)
  if (typeof changes === 'string' || (changes.print !== held.print) === isStale) return
  isStale = !isStale
  await refreshStatus($)
  $.ui.invalidate('ui.render')
}

/**
 * Opens the pane. Opened because the person asked, it is placed at any width
 * and asks for the keyboard. Opened when a report arrives it takes no
 * keyboard from them, and it may wait for a wider terminal: then a toast says
 * how to bring it up.
 */
const openPane = async ($: EngineInterface, isAsked: boolean): Promise<void> => {
  try {
    const opened = await $.ui.open({
      id: PANE,
      title: 'Ripple',
      columns: PANE_COLUMNS,
      ...(isAsked ? { focus: true as const } : {}),
    })
    if (!opened.isPlaced) $.ui.toast('Ripple: the map is ready. Run /ripple to open it.')
  } catch (error) {
    $.ui.log(`ripple: could not open the pane: ${describe(error)}`, { to: 'debug' })
  }
}

/** Whether the mapper Ripple is waiting on is still at work; one that ended without a word is forgotten. */
const isMapping = async ($: EngineInterface): Promise<boolean> => {
  const at = await read($, mapping)
  if (at === null) return false
  const agent = (await $.agent.list()).find(one => one.id === at.agentId)
  if (agent !== undefined && ['pending', 'running', 'waiting'].includes(agent.status)) return true
  await update($, mapping, () => null)
  await refreshStatus($)
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
  const isBusy = await isMapping($)
  const at = await read($, mapping)
  if (isBusy && at !== null) {
    const isSame = at.print === changes.print && at.focus === focus
    return isSame ? undefined : 'Ripple: still mapping what was asked before. Run this again once that map is in.'
  }
  const held = await read($, map)
  if (!isForced && held !== null && held.print === changes.print && held.focus === focus) {
    if (isStale) {
      isStale = false
      await refreshStatus($)
    }
    return undefined
  }
  if (isStarting) return undefined
  isStarting = true
  try {
    const spawned = await $.agent.spawn({
      subagentType: MAPPER_TYPE,
      description: `Map ${describeChanges(changes)}`,
      prompt: taskPrompt(changes, focus, await rootOf($)),
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
  } finally {
    isStarting = false
  }
}

const styleOf = (paint: Paint): TextProps => {
  const color = COLORS[paint]
  return { ...(color === undefined ? {} : { color }), ...(paint === 'dim' ? { dimColor: true } : {}) }
}

const LEGEND_LABELS = LEGEND.map(mark => `${mark.glyph} ${mark.label}`)

const legend = ({ Box, Text }: Kit): RenderElement => (
  <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
    {LEGEND.map((mark, index) => (
      <Text {...styleOf(mark.paint)}>{LEGEND_LABELS[index]}</Text>
    ))}
  </Box>
)

/** The pane's keys under a map with symbols, in the order they are drawn. */
const keysOf = (drawn: RippleMode): Array<{ key: string; label: string; isDim: boolean }> => [
  { key: 'h', label: '←', isDim: true },
  { key: 'j', label: '↓', isDim: true },
  { key: 'k', label: '↑', isDim: true },
  { key: 'l', label: '→', isDim: true },
  { key: 'u', label: 'symbol ↑', isDim: true },
  { key: 'd', label: 'symbol ↓', isDim: true },
  { key: 'n', label: 'next flagged', isDim: true },
  { key: 't', label: drawn === 'tree' ? 'graph view' : 'tree view', isDim: true },
  { key: ASK, label: 'ask Claude', isDim: false },
  { key: REMAP, label: 're-map', isDim: false },
]

/** Asks Claude, in the conversation, about the selected node. */
const ask = async ($: EngineInterface): Promise<void> => {
  const held = await read($, map)
  const node = held === null ? undefined : selectedOf(held, (await read($, view)).selected)
  if (held === null || node === undefined) return
  $.ui.toast(`Ripple: asked Claude about ${node.name}.`)
  await $.prompt.submit({ text: askPrompt(node, held) })
}

const isPan = (value: unknown): value is Pan =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as Pan).x) &&
  Number.isFinite((value as Pan).y)

/** Scrolls the map's window from where the person left it, or where it was last drawn: by cells, or by turns of the wheel. */
const scrollMap = async ($: EngineInterface, by: Pan | number): Promise<void> => {
  const held = await read($, map)
  if (held === null) return
  const files = filesOf(held)
  await update($, view, seen => ({
    ...seen,
    pan: views[shown.mode].scroll(files, shown.room, seen.pan ?? shown.pan, by),
  }))
}

/** Scrolls the list under the map from where the person left it, or where it was last drawn, by rows. */
const scrollSymbols = async ($: EngineInterface, by: number): Promise<void> => {
  const held = await read($, map)
  if (held === null) return
  const file = fileOf(filesOf(held), selectedOf(held, (await read($, view)).selected)?.id ?? null)
  if (file === undefined) return
  await update($, view, seen => ({ ...seen, top: scrollList(file, shown.listRows, seen.top ?? shown.top, by) }))
}

/**
 * Selects a symbol. The list goes back to following the selection, and so
 * does the map's window when the symbol is in another file than the one
 * selected; a symbol already selected changes nothing.
 */
const select = async ($: EngineInterface, held: RippleMap, to: string | null): Promise<void> => {
  const files = filesOf(held)
  const from = selectedOf(held, (await read($, view)).selected)?.id ?? null
  if (to === null || to === from) return
  const isSameFile = fileOf(files, to) === fileOf(files, from)
  await update($, view, seen => ({ ...seen, selected: to, pan: isSameFile ? seen.pan : null, top: null }))
}

/**
 * Does what one key of the pane does: a Button's, or a key the map or the
 * list was handed. In the list, up and down go through the file's symbols.
 */
const press = async ($: EngineInterface, key: string, isInList = false): Promise<void> => {
  try {
    const held = await read($, map)
    if (held === null) return
    const files = filesOf(held)
    const at = selectedOf(held, (await read($, view)).selected)?.id ?? null
    const file = fileOf(files, at)
    const move = MOVES[key]
    const listMove = LIST_MOVES[key] ?? (isInList && (move === 'up' || move === 'down') ? move : undefined)
    if (listMove !== undefined) {
      if (file !== undefined) await select($, held, stepInList(file, at, listMove))
    } else if (move !== undefined) {
      await select($, held, views[shown.mode].step(files, at, move, shown.room, shown.pan))
    } else if (key === 'n') {
      await select($, held, nextFlagged(held, at))
    } else if (key === 't') {
      const other: RippleMode = shown.mode === 'tree' ? 'graph' : 'tree'
      await update($, view, seen => ({ ...seen, mode: other, pan: null }))
    } else if (key === ASK) {
      await ask($)
    } else if (key === REMAP) {
      const said = await showMap($, held.scope, held.focus, true)
      if (said !== undefined) $.ui.toast(said)
    }
  } catch (error) {
    $.ui.toast(`Ripple: ${describe(error)}`)
  }
}

export const register: Register = (on, options) => {
  firstMode = options.view === 'tree' ? 'tree' : 'graph'
  views = viewsOf(options.scroll === 'sheet' ? 'sheet' : 'pinned')

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
        argumentHint: '[branch] [focus] | reset',
      })
      if ((await read($, map)) === null) {
        const kept = readStored(await $.store.get(await storeKey($)))
        if (kept !== null) await update($, map, () => kept)
      }
      await refreshStatus($)
      await checkStale($)
    } catch (error) {
      $.ui.log(`ripple: session start: ${describe(error)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('agent.offer', { agent: 'ripple:mapper' }, () => ({ isOffered: false })).catch(($, e, next) => next(e))

  on('command.run', { command: 'ripple' }, async ($, e) => {
    let said: string | undefined
    try {
      const request = readRequest(e.args)
      if (request.verb === 'map') {
        said = await showMap($, request.scope, request.focus, false)
        if (said === undefined) await openPane($, true)
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

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.agentId === undefined || verdict.decision !== 'ask') return verdict
    const agent = (await $.agent.list()).find(one => one.id === e.agentId)
    return agent?.type === MAPPER_TYPE ? { decision: 'deny', reason: NO_ASKING } : verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__ripple__report' }, async ($, e) => {
    const at = await read($, mapping)
    if (at === null || e.agentId !== at.agentId) {
      return { deny: 'Only the mapper Ripple is waiting on reports a map. The person runs /ripple to start one.' }
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
    await update($, view, seen => ({ ...seen, selected: null, pan: null, top: null }))
    isStale = false
    await persist($, made)
    await refreshStatus($)
    await checkStale($)
    await openPane($, false)
    return { result: reportReply(reported.report, reported.notes) }
  }).catch(() => ({ deny: 'Ripple failed while reading the report.' }))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    try {
      if (e.agentId === undefined) {
        await checkStale($)
      } else if ((await read($, mapping))?.agentId === e.agentId) {
        await stopMapping($, 'Ripple: the mapper ended without a map. Run /ripple to try again.')
      }
    } catch (error) {
      $.ui.log(`ripple: turn end: ${describe(error)}`, { to: 'debug' })
    }
    return done
  })

  /**
   * Answers the pane's keys. A Button's own closure runs beneath this
   * module's hooks, where a mapper it started would be out of their reach.
   */
  on('ui.press', { plugin: 'ripple', component: 'Pane', requestId: 'ripple' }, async ($, e) => {
    await press($, e.element)
    return { element: e.element }
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || typeof e.data !== 'object' || e.data === null) return next(e)
    const { select: picked, scroll, key } = e.data as { select?: unknown; scroll?: unknown; key?: unknown }
    const held = await read($, map)
    if (typeof picked === 'string' && held !== null) await select($, held, picked)
    else if (typeof key === 'string') await press($, key, e.element === 'list')
    else if (isPan(scroll)) await scrollMap($, scroll)
    return {}
  })

  on('ui.scroll', { component: 'Pane', requestId: 'ripple' }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || e.pointer === undefined || e.contentRows > e.bodyRows) return next(e)
    if (e.pointer.row < shown.listAt) await scrollMap($, e.by)
    else await scrollSymbols($, e.by)
    return {}
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'ripple' }, async ($, e) => {
    const held = await read($, map)
    const at = await read($, mapping)
    const seen = await read($, view)
    const columns = Math.max(MIN_COLUMNS, e.props.bodyColumns)

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
    const button = (key: string, label: string, isDim = false): RenderElement => (
      <Button
        key={key}
        label={label}
        hotkey={key}
        plain
        {...(isDim ? { dimColor: true } : {})}
        onPress={() => undefined}
      />
    )

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const side = Math.round(
        Math.min(RING_PIXELS.most, Math.max(RING_PIXELS.least, columns * RING_PIXELS.perColumn)),
      )
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
          {held !== null && button(REMAP, 're-map')}
        </Box>
      )
    }

    const { Client, Link } = $.ui.resolve(e)
    const files = hasNodes ? filesOf(held) : undefined
    const node = hasNodes ? selectedOf(held, seen.selected) : undefined
    const file = files === undefined ? undefined : fileOf(files, node?.id ?? null)
    const asked = modeIn(seen.mode ?? firstMode, { columns, rows: WHOLE_ROWS })
    const plan = planOf(
      { columns, rows: e.props.scroll.bodyRows },
      {
        summary: held?.summary ?? '',
        hasNotice: notice !== undefined,
        legend: LEGEND_LABELS,
        keys: keysOf(asked).map(one => one.label),
        symbols: Math.max(1, ...(files?.files ?? []).map(one => one.symbols.length)),
        mapNeeds:
          files === undefined ? 0 : views[asked].draw(files, null, { columns, rows: WHOLE_ROWS }, ORIGIN).rows.length,
      },
    )
    const room = { columns, rows: plan.mapRows }
    const gap = plan.isCompact ? 0 : 1
    const mode = modeIn(asked, room)
    const keys = keysOf(mode).filter(one => one.key !== 't' || modeIn('graph', room) === 'graph')
    const root = await rootOf($)

    let drawn: RenderElement | false = false
    if (files !== undefined && file !== undefined && node !== undefined && hasNodes) {
      const pan = seen.pan ?? views[mode].show(files, node.id, room, shown.pan)
      const top = seen.top ?? showInList(file, node.id, plan.listRows, shown.top)
      const picture = views[mode].draw(files, node.id, room, pan)
      const says = listSays(file, plan.listRows, top)
      shown = { mode, room, pan, listRows: plan.listRows, top, listAt: plan.mapTop + picture.rows.length + gap }
      drawn = (
        <Box flexDirection="column" marginTop={gap}>
          <Client key="map" module="./pane.tsx" props={picture} />
          <Box flexDirection="column" marginTop={gap}>
            <Text wrap="truncate-end">
              <Text bold>{`▸ ${clipStart(file.path, Math.max(1, columns - says.length - OVER_LIST_CHARS))}`}</Text>
              <Text dimColor>{` · ${says} · `}</Text>
              <Link href={`file://${root}/${file.path}`} label="open" />
            </Text>
            <Box flexDirection="column" height={plan.listRows + plan.detailRows} overflow="hidden">
              <Client
                key="list"
                module="./pane.tsx"
                props={drawList(file, node.id, { columns, rows: plan.listRows }, top)}
              />
              {!plan.isCompact && (
                <Text wrap="truncate-end">
                  <Text bold>{node.name}</Text>
                  <Text dimColor>{` · ${factsOf(held, node)}`}</Text>
                </Text>
              )}
              {node.reason !== undefined && (
                <Text wrap={plan.isCompact ? 'truncate-end' : 'wrap'} {...styleOf(markOf(node).paint)}>
                  {node.reason}
                </Text>
              )}
            </Box>
          </Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {held === null ? 'Ripple' : headerText(held)}
        </Text>
        {!plan.isCompact && held !== null && (
          <Text dimColor wrap="truncate-end">
            {originText(held)}
          </Text>
        )}
        {!plan.isCompact && held?.summary !== undefined && <Text wrap="wrap">{held.summary}</Text>}
        {noticeLine}
        {!plan.isCompact && hasNodes && legend(kit)}
        {drawn}
        {held !== null && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={gap}>
            {hasNodes ? keys.map(one => button(one.key, one.label, one.isDim)) : button(REMAP, 're-map')}
          </Box>
        )}
      </Box>
    )
  })
}
