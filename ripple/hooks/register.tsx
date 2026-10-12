import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import type { RippleMap, RippleNode, RippleScope } from '../types'
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
import {
  REPORT_DESCRIPTION,
  REPORT_SCHEMA,
  REPORT_TOOL,
  flagged,
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
import { graphHtml, ringSvg } from './web'

const PANE = 'ripple'
const NOT_A_REPOSITORY = 'Ripple: this is not a git repository, so there are no changes to map.'
const NO_DEFAULT_BRANCH =
  'Ripple: found no default branch to compare this one with (looked for origin/HEAD, main, and master). Run /ripple to map the uncommitted changes.'

const map = atom({ plugin: 'ripple', key: 'map' } as const, null)
const mapping = atom({ plugin: 'ripple', key: 'mapping' } as const, null)

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
    const opened = await $.ui.open({ id: PANE, title: 'Ripple', columns: 72 })
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

const MARK = {
  changed: { glyph: '◆', color: 'suggestion' },
  breaks: { glyph: '●', color: 'error' },
  review: { glyph: '▲', color: 'warning' },
  ok: { glyph: '○', color: 'text' },
} as const

/** One node on one line: its mark, its name, where it is, and why it is flagged. */
const nodeLine = ({ Text }: Kit, node: RippleNode): RenderElement => {
  const mark = MARK[node.role === 'changed' ? 'changed' : node.risk]
  const where = node.line > 0 ? `${node.file}:${node.line}` : node.file
  return (
    <Text wrap="truncate-end">
      <Text color={mark.color}>{`${mark.glyph} ${node.name}`}</Text>
      <Text dimColor>{`  ${where}${node.reason === undefined ? '' : `  ${node.reason}`}`}</Text>
    </Text>
  )
}

const legend = ({ Box, Text }: Kit): RenderElement => (
  <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
    <Text color="suggestion">◆ changed</Text>
    <Text color="error">● breaks</Text>
    <Text color="warning">▲ review</Text>
    <Text>○ ok</Text>
  </Box>
)

export const register: Register = on => {
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const held = await read($, map)
    const at = await read($, mapping)
    const columns = Math.max(24, e.props.bodyColumns)

    const attempt = (work: Promise<string | undefined>): void => {
      void work
        .then(said => {
          if (said !== undefined) $.ui.toast(said)
        })
        .catch((error: unknown) => $.ui.toast(`Ripple: ${describe(error)}`))
    }
    const ask = (node: RippleNode): void => {
      if (held === null) return
      $.ui.toast(`Ripple: asked Claude about ${node.name}.`)
      attempt($.prompt.submit({ text: askPrompt(node, held), asUser: true }).then(() => undefined))
    }
    const remap = (): void => {
      if (held !== null) attempt(showMap($, held.scope, held.focus, true))
    }

    const kit: Kit = $.ui.resolve(e)
    const { Box, Text, Button } = kit
    const hasNodes = held !== null && held.nodes.length > 0
    const top = (
      <Box flexDirection="column">
        <Text bold>{held === null ? 'Ripple' : headerText(held)}</Text>
        {held !== null && <Text dimColor>{originText(held)}</Text>}
        {held?.summary !== undefined && <Text wrap="wrap">{held.summary}</Text>}
        {at !== null && <Text color="warning">◌ Mapping…</Text>}
        {at === null && held !== null && isStale && (
          <Text dimColor>The changes have moved on since this map · /ripple to map them again</Text>
        )}
        {held === null && at === null && <Text dimColor>No map yet. Run /ripple to map your changes.</Text>}
      </Box>
    )
    const buttons = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
        {(held === null ? [] : flagged(held)).slice(0, 9).map((node, index) => (
          <Button
            key={`ask-${index + 1}`}
            label={`Ask about ${node.name}`}
            hotkey={String(index + 1)}
            plain
            onPress={() => ask(node)}
          />
        ))}
        {held !== null && <Button key="remap" label="Re-map" hotkey="r" plain onPress={remap} />}
        {held !== null && (
          <Button key="web" label="Open in browser" hotkey="w" plain onPress={() => attempt(writeWeb($))} />
        )}
      </Box>
    )

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          {top}
          {hasNodes && legend(kit)}
          {hasNodes && (
            <Box flexDirection="column" marginTop={1}>
              {held.nodes.map(node => nodeLine(kit, node))}
            </Box>
          )}
          {buttons}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const side = Math.round(Math.min(720, Math.max(300, columns * 8)))
    return (
      <Box flexDirection="column" gap={1}>
        {top}
        {hasNodes && (
          <Svg source={ringSvg(held)} alt={headerText(held)} width={side} height={side} isInteractive />
        )}
        {hasNodes && legend(kit)}
        {buttons}
      </Box>
    )
  })
}
