import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, RenderPropsOf } from 'claude-code'

import { SHOP_MAP, SHOP_REPORT } from './fixture'
import { HEAD, readChanges } from '../hooks/changes'
import { rowText } from '../hooks/draw'
import type { Hit } from '../hooks/draw'
import { filesOf } from '../hooks/files'
import { NO_ASKING } from '../hooks/mapper'
import { VIEWS } from '../hooks/view'

// The whole loop through the engine: /ripple reads the changes from git and
// starts a mapper, the mapper's report becomes the map, and the pane draws it.

const ROOT = '/repo/shop'
const STORE_KEY = `map:${ROOT}`
const MERGE_BASE = '4f1c2aa9d0c1b7e55f0a6f1d2c3b4a5968778695'

const PANE: RenderPropsOf['Pane'] = {
  title: 'Ripple',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const fileDiff = (file: string, line: number, added: string): string =>
  [
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${line} +${line} @@`,
    '-old',
    `+${added}`,
    '',
  ].join('\n')

/** The change: formatPrice gains a parameter. */
const PRICE_DIFF = fileDiff('src/price.ts', 1, 'export function formatPrice(amount: number, currency: string): string {')
const CART_DIFF = fileDiff('src/cart.ts', 14, '  return formatPrice(total, cart.currency)')
const PRICE_PRINT = readChanges('uncommitted', HEAD, PRICE_DIFF, '').print

/** The git commands Ripple reads a scope with, less the leading `git`. */
const DIFF = (ref: string) => [
  '-c',
  'core.quotePath=false',
  'diff',
  ref,
  '--relative',
  '--unified=0',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--',
  '.',
  ':(exclude).ripple',
]
const UNTRACKED = ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '--', '.', ':(exclude).ripple']

/**
 * Stands in for everything beneath the plugin: git, the store, the agents,
 * and the surface. Returns what the plugin did to each. The kit hands a
 * plugin's spawn on as the Agent tool's call, and reads the agent it started
 * off that tool's result.
 */
const world = (on: On, options: { stored?: Record<string, unknown>; isWindows?: boolean } = {}) => {
  const seen = {
    status: [] as Array<string | undefined>,
    toasts: [] as string[],
    prompts: [] as string[],
    opened: [] as string[],
    /** Whether each opening of the pane asked for the keyboard. */
    askedFocus: [] as boolean[],
    closed: [] as string[],
    tools: [] as Array<{ name: string; isDeferred: unknown }>,
    agents: [] as Array<{ name: string; tools: unknown; background: unknown }>,
    commands: [] as string[],
    spawned: [] as Array<{ subagentType: string; prompt: string }>,
    files: new Map<string, string>(),
    ran: [] as string[][],
    git: [] as string[][],
    /** What `git diff` answers. */
    diff: '',
    /** What `git ls-files --others` answers, and what `git hash-object` answers for those files. */
    untracked: '',
    hashes: '',
    /** Whether `git diff` fails, as it does in a repository with no commits. */
    isDiffFailing: false,
    /** Why the engine refuses to start an agent; '' when it starts one. */
    spawnRefusal: '',
    /** Whether the surface has room for the pane. */
    isPlaced: true,
    /** The default branch as `origin/HEAD` names it; '' when the repository has none. */
    defaultBranch: '',
    isRepository: true,
    /** How the agents the plugin started stand; a spawned one runs until a test says otherwise. */
    statusOf: new Map<string, AgentInfo['status']>(),
    stored: new Map<string, unknown>(Object.entries(options.stored ?? {})),
  }
  mock.clock(on)
  mock.env(on, options.isWindows === true ? { OS: 'Windows_NT' } : {})

  on('store.get', ($, e) => ({ value: seen.stored.get(e.key) }))
  on('store.set', ($, e) => {
    seen.stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    seen.stored.delete(e.key)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({
    value: seen.isRepository ? { root: ROOT, remote: null, internal: false, name: null } : null,
  }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.register', ($, e) => {
    seen.tools.push({ name: e.name, isDeferred: e.isDeferred })
    return { value: { tool: `mcp__ripple__${e.name}` } }
  })
  on('command.register', ($, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('agent.register', ($, e) => {
    seen.agents.push({ name: e.name, tools: e.tools, background: e.background })
    return { value: { agent: `ripple:${e.name}` } }
  })
  on('agent.spawn', ($, e) => {
    if (seen.spawnRefusal !== '') return { deny: seen.spawnRefusal }
    const call = e as unknown as { subagent_type: string; prompt: string }
    seen.spawned.push({ subagentType: call.subagent_type, prompt: call.prompt })
    const agentId = `mapper-${seen.spawned.length}`
    seen.statusOf.set(agentId, 'running')
    return { model: 'inherit', result: { agentId } } as never
  })
  on('agent.list', () => ({
    value: [...seen.statusOf].map(([id, status]) => ({ id, status, description: 'map', type: 'ripple:mapper' })),
  }))
  on('agent.offer', () => ({ isOffered: true }))
  on('tool.check', ($, e) => ({ decision: e.tool === 'Read' ? 'allow' : e.tool === 'Write' ? 'deny' : 'ask' }))
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.status', ($, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    seen.askedFocus.push(e.focus === true)
    return { value: seen.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } } as never
  })
  on('ui.close', ($, e) => {
    seen.closed.push(e.id)
    return { value: undefined }
  })
  on('fs.write', ($, e) => {
    seen.files.set(e.path.replaceAll('\\', '/'), e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const [program, ...rest] = e.argv
    if (program !== 'git') {
      seen.ran.push([...e.argv])
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    seen.git.push(rest)
    const answer = (stdout: string | undefined) => ({
      value: {
        exitCode: stdout === undefined ? 1 : 0,
        stdout: stdout ?? '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    })
    if (rest.includes('diff')) return answer(seen.isDiffFailing ? undefined : seen.diff)
    if (rest.includes('ls-files')) return answer(seen.untracked)
    if (rest.includes('hash-object')) return answer(seen.hashes)
    if (rest.includes('symbolic-ref')) return answer(seen.defaultBranch === '' ? undefined : seen.defaultBranch)
    if (rest.includes('merge-base')) return answer(MERGE_BASE)
    return answer(undefined)
  })
  return seen
}

const start = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

/** `/ripple <args>` as the person typing it at the prompt. */
const ripple = ($: Engine, args = '') =>
  $.command.run({
    command: 'ripple',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

/** The mapper `agentId` reporting the shop's map. */
const report = ($: Engine, agentId: string, input: object = SHOP_REPORT) =>
  $.tool.call({ tool: 'mcp__ripple__report', agentId, ...input })

/** A turn ending: the person's own, or with `agentId` an agent's. */
const turnEnds = ($: Engine, agentId?: string) =>
  $.turn.complete({
    answer: 'done',
    durationMs: 5,
    isAborted: false,
    reason: 'answer',
    turnId: `turn-${agentId ?? 'main'}`,
    ...(agentId === undefined ? {} : { agentId }),
  })

/** The pane as the terminal draws it. */
const mountPane = ($: Engine, props: RenderPropsOf['Pane'] = PANE) =>
  $.ui.mount({ plugin: 'ripple', surface: 'terminal', component: 'Pane', requestId: 'ripple', props })

/** Every line of text the pane shows: what is said around the map, and no part of the map itself. */
const paneText = async ($: Engine): Promise<string[]> => {
  const pane = await mountPane($)
  const texts = (await pane.findAll({ type: 'Text' })).map(found => found.text)
  await pane.unmount()
  return texts
}

type Pane = Awaited<ReturnType<typeof mountPane>>

/** The rows one of the pane's two surface modules drew: the map's, or the list's under it. */
const rowsOf = async (pane: Pane, client: 'map' | 'list'): Promise<string[]> => {
  const drawn = (await pane.drawn({ in: client })) as { children?: Array<{ children?: unknown[] }> }
  return (drawn.children ?? []).map(row =>
    (row.children ?? [])
      .map(span => (typeof span === 'string' ? span : ((span as { children?: string[] }).children ?? []).join('')))
      .join(''),
  )
}

const mapRows = (pane: Pane): Promise<string[]> => rowsOf(pane, 'map')

/** The path the list under the map is headed with: the selected file's. */
const selectedFile = async (pane: Pane): Promise<string | undefined> =>
  (await pane.find({ type: 'Text', text: /^▸ \S+$/ }))?.text.slice(2)

/** The name the list marks: the selected symbol's. */
const selectedSymbol = async (pane: Pane): Promise<string | undefined> =>
  (await pane.findAll({ in: 'list', type: 'Text' })).find(found => found.props.inverse === true)?.text

const SHOP = filesOf(SHOP_MAP)
const ORIGIN = { x: 0, y: 0 }
const id = (name: string): string => SHOP_MAP.nodes.find(one => one.name === name)?.id ?? ''

/** The shop's graph as the pane first draws it in a room `columns` wide and tall enough for all of it. */
const graphIn = (columns: number) => VIEWS.graph.draw(SHOP, id('renderCart'), { columns, rows: 40 }, ORIGIN)

/** Where the box of the file that holds symbol `name` is in the pane's graph. */
const boxOf = (name: string): Hit => {
  const file = SHOP.files.find(one => one.symbols.some(symbol => symbol.name === name))
  const hit = graphIn(PANE.bodyColumns).hits.find(one => 'id' in one && file?.symbols.some(symbol => symbol.id === one.id))
  if (hit === undefined) throw new Error(`the file of ${name} is not drawn`)
  return hit
}

/** A session with the shop's map on hand, as its mapper reported it. */
const mapped = async ($: Engine, on: On) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await report($, 'mapper-1')
  seen.statusOf.set('mapper-1', 'completed')
  return seen
}

test('session start registers a deferred report tool, a mapper with nothing to edit with, and /ripple, and reads no git', async ($, on) => {
  const seen = world(on)
  await start($)
  expect(seen.tools).toEqual([{ name: 'report', isDeferred: true }])
  expect(seen.agents).toEqual([
    { name: 'mapper', tools: ['Read', 'Bash', 'LSP', 'mcp__ripple__report'], background: true },
  ])
  expect(seen.commands).toEqual(['ripple'])
  expect(seen.git).toEqual([])
  expect(seen.status.at(-1)).toBeUndefined()
})

test('the mapper is never offered to the model, and other agents still are', async ($, on) => {
  world(on)
  await start($)
  const offer = (agent: string) =>
    $.agent.offer({ agent, description: '', source: 'plugin', provider: { plugin: 'ripple', tier: 'user' } })
  expect(await offer('ripple:mapper')).toEqual({ isOffered: false })
  expect(await offer('Explore')).toEqual({ isOffered: true })
})

test('/ripple with a clean tree says so and starts no mapper', async ($, on) => {
  const seen = world(on)
  await start($)
  const answered = await ripple($)
  expect(answered.text).toStartWith('Ripple: nothing to map. Git shows no uncommitted changes here.')
  expect(seen.spawned).toEqual([])
  expect(seen.opened).toEqual([])
})

test('/ripple outside a git repository says so without running git', async ($, on) => {
  const seen = world(on)
  seen.isRepository = false
  await start($)
  expect((await ripple($)).text).toBe('Ripple: this is not a git repository, so there are no changes to map.')
  expect(seen.git).toEqual([])
})

test('/ripple starts a mapper on the uncommitted diff, and its report becomes the map of those changes', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  seen.untracked = 'src/fresh.ts\n'
  await start($)

  expect(await ripple($, 'formatPrice')).toEqual({})
  expect(seen.git).toEqual([DIFF('HEAD'), UNTRACKED, ['hash-object', '--', 'src/fresh.ts']])
  expect(seen.spawned).toHaveLength(1)
  expect(seen.spawned[0]?.subagentType).toBe('ripple:mapper')
  expect(seen.spawned[0]?.prompt).toContain(
    'Your shell starts in the project root, /repo/shop. Read the changes with `git diff --relative HEAD`, run exactly as written',
  )
  expect(seen.spawned[0]?.prompt).toContain('- src/price.ts (1 hunk)\n- src/fresh.ts (new, not in the diff: read the file)')
  expect(seen.spawned[0]?.prompt).toContain('Focus: formatPrice')
  expect(seen.status.at(-1)).toBe('mapping…')
  expect(seen.opened).toEqual(['ripple'])
  expect(seen.prompts).toEqual([])
  expect(await paneText($)).toContain('◌ Mapping…')

  const reported = await report($, 'mapper-1')
  expect(reported.result).toBe(
    'Ripple drew the map: 1 changed, 6 dependents, 2 breaking, 1 to review. Reply with one short sentence and stop.',
  )
  const print = readChanges('uncommitted', HEAD, PRICE_DIFF, 'src/fresh.ts\n').print
  expect(seen.stored.get(STORE_KEY)).toEqual({ ...SHOP_MAP, focus: 'formatPrice', print })
  expect(seen.status.at(-1)).toBe('2 break · 1 to review · /ripple')

  const drawn = await paneText($)
  expect(drawn).toContain('Ripple · 1 change → 6 dependents · 2 break · 1 to review')
  expect(drawn).toContain('uncommitted changes · via LSP · focus: formatPrice')
  expect(drawn).toContain(SHOP_MAP.summary)
  expect(drawn).not.toContain('◌ Mapping…')
  expect(drawn).toContain('▸ src/cart.ts')

  const toasts = seen.toasts.length
  await turnEnds($, 'mapper-1')
  expect(seen.toasts).toHaveLength(toasts)
})

test('a report from anyone but the mapper Ripple started is refused', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)

  const unasked = await $.tool.call({ tool: 'mcp__ripple__report', ...SHOP_REPORT })
  expect(unasked.deny).toContain('Only the mapper Ripple is waiting on reports a map.')

  await ripple($)
  expect((await report($, 'someone-else')).deny).toContain('Only the mapper Ripple is waiting on')
  expect(seen.stored.has(STORE_KEY)).toBe(false)
  expect((await report($, 'mapper-1')).deny).toBeUndefined()
  expect((await report($, 'mapper-1', { ...SHOP_REPORT, nodes: [] })).deny).toContain('Only the mapper')
  expect(seen.stored.get(STORE_KEY)).toMatchObject({ nodes: SHOP_MAP.nodes })
})

test('a report that cannot be read is refused with the reason, and the mapper may report again', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)

  const refused = await report($, 'mapper-1', { method: 'lsp', nodes: 'everything', edges: [] })
  expect(refused.deny).toBe(
    'Ripple could not read the map: `nodes` must be an array. Fix it and call mcp__ripple__report again.',
  )
  expect(seen.status.at(-1)).toBe('mapping…')
  expect((await report($, 'mapper-1')).deny).toBeUndefined()
  expect(seen.stored.has(STORE_KEY)).toBe(true)
})

test('changes already mapped are shown again without a mapper; a new focus or a new diff starts one', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await report($, 'mapper-1')
  seen.statusOf.set('mapper-1', 'completed')

  expect(await ripple($)).toEqual({})
  expect(seen.spawned).toHaveLength(1)
  expect(seen.opened).toHaveLength(3)

  await ripple($, 'renderCart')
  expect(seen.spawned).toHaveLength(2)
  await report($, 'mapper-2')

  seen.diff = PRICE_DIFF + CART_DIFF
  await ripple($, 'renderCart')
  expect(seen.spawned).toHaveLength(3)
})

test('/ripple while a mapper is at work starts no second one, but one that died is replaced', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  expect(await ripple($)).toEqual({})
  expect(seen.spawned).toHaveLength(1)
  expect((await ripple($, 'renderCart')).text).toBe(
    'Ripple: still mapping what was asked before. Run this again once that map is in.',
  )
  expect(seen.spawned).toHaveLength(1)

  seen.statusOf.set('mapper-1', 'killed')
  await ripple($)
  expect(seen.spawned).toHaveLength(2)
  expect((await report($, 'mapper-1')).deny).toContain('Only the mapper')
  expect((await report($, 'mapper-2')).deny).toBeUndefined()
})

test('/ripple branch reads against the commit the branch left the default branch at', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  seen.defaultBranch = 'origin/main\n'
  await start($)

  expect(await ripple($, 'branch')).toEqual({})
  expect(seen.git).toEqual([
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    ['merge-base', 'HEAD', 'origin/main'],
    DIFF(MERGE_BASE),
    UNTRACKED,
  ])
  expect(seen.spawned[0]?.prompt).toStartWith(
    `Map what this branch changed since it left main, uncommitted changes included.\nYour shell starts in the project root, /repo/shop. Read the changes with \`git diff --relative ${MERGE_BASE}\`, run exactly as written`,
  )
  await report($, 'mapper-1')
  expect(seen.stored.get(STORE_KEY)).toMatchObject({ scope: 'branch', base: 'main' })
  expect(await paneText($)).toContain('branch since main · via LSP')

  seen.statusOf.set('mapper-1', 'completed')
  await ripple($)
  expect(seen.spawned).toHaveLength(2)
})

test('/ripple branch with no default branch to compare with says where it looked', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  const answered = await ripple($, 'branch')
  expect(answered.text).toContain('found no default branch to compare this one with (looked for origin/HEAD, main, and master)')
  expect(seen.git.some(argv => argv.includes('diff'))).toBe(false)
  expect(seen.spawned).toEqual([])
})

test('a mapper never asks: what would raise a dialog is refused for it, for as long as it runs, and for no one else', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  const check = (tool: string, agentId?: string) =>
    $.tool.check({ tool, input: {}, ...(agentId === undefined ? {} : { agentId }) })

  expect(await check('Bash', 'mapper-1')).toEqual({ decision: 'deny', reason: NO_ASKING })
  expect(await check('Read', 'mapper-1')).toEqual({ decision: 'allow' })
  expect(await check('Write', 'mapper-1')).toEqual({ decision: 'deny' })
  expect(await check('Bash', 'another-agent')).toEqual({ decision: 'ask' })
  expect(await check('Bash')).toEqual({ decision: 'ask' })

  await report($, 'mapper-1')
  expect(await check('Bash', 'mapper-1')).toEqual({ decision: 'deny', reason: NO_ASKING })
  await ripple($, 'reset')
  expect(await check('Bash', 'mapper-1')).toEqual({ decision: 'deny', reason: NO_ASKING })
})

test('a mapper that ends without a report stops the wait and says so', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await turnEnds($, 'some-other-agent')
  expect(seen.status.at(-1)).toBe('mapping…')

  await turnEnds($, 'mapper-1')
  expect(seen.status.at(-1)).toBeUndefined()
  expect(seen.toasts.at(-1)).toBe('Ripple: the mapper ended without a map. Run /ripple to try again.')
  expect(await paneText($)).toContain('No map yet. Run /ripple to map your changes.')
})

test('a map whose changes have moved on says so after the person\'s turn, and stops once they are back', async ($, on) => {
  const seen = await mapped($, on)
  const stale = 'The changes have moved on since this map · /ripple to map them again'
  const pane = await mountPane($)
  const isSaid = async () => (await pane.find({ type: 'Text', text: stale })) !== undefined

  await turnEnds($)
  expect(await isSaid()).toBe(false)
  expect(seen.status.at(-1)).toBe('2 break · 1 to review · /ripple')

  seen.diff = PRICE_DIFF + CART_DIFF
  await turnEnds($)
  expect(await isSaid()).toBe(true)
  expect(seen.status.at(-1)).toBeUndefined()

  seen.diff = PRICE_DIFF
  await turnEnds($)
  expect(await isSaid()).toBe(false)
  expect(seen.status.at(-1)).toBe('2 break · 1 to review · /ripple')
  await pane.unmount()
})

test('an edit to a file git does not track yet leaves the map behind too', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  seen.untracked = 'src/fresh.ts\n'
  seen.hashes = '3e757656\n'
  await start($)
  await ripple($)
  await report($, 'mapper-1')
  seen.statusOf.set('mapper-1', 'completed')

  seen.hashes = 'be761e03\n'
  await turnEnds($)
  expect(await paneText($)).toContain('The changes have moved on since this map · /ripple to map them again')
  await ripple($)
  expect(seen.spawned).toHaveLength(2)
})

test('a map that arrives after the changes moved on is stale from the start', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  seen.diff = PRICE_DIFF + CART_DIFF
  await report($, 'mapper-1')
  expect(seen.stored.get(STORE_KEY)).toMatchObject({ print: PRICE_PRINT })
  expect(await paneText($)).toContain('The changes have moved on since this map · /ripple to map them again')
  expect(seen.status.at(-1)).toBeUndefined()
})

test('a failed reading of the changes is said to be one, and never taken for no changes or for a change', async ($, on) => {
  const seen = await mapped($, on)
  seen.isDiffFailing = true
  expect((await ripple($)).text).toBe(
    'Ripple: git could not show the changes. A repository with no commits yet has nothing to compare them with.',
  )
  await turnEnds($)
  expect(await paneText($)).not.toContain('The changes have moved on since this map · /ripple to map them again')
  expect(seen.spawned).toHaveLength(1)
})

test('a map kept from an earlier session comes back at session start', async ($, on) => {
  const seen = world(on, { stored: { [STORE_KEY]: { ...SHOP_MAP, print: PRICE_PRINT } } })
  seen.diff = PRICE_DIFF
  await start($)
  expect(seen.status.at(-1)).toBe('2 break · 1 to review · /ripple')
  expect(await ripple($)).toEqual({})
  expect(seen.spawned).toEqual([])
  expect(await paneText($)).toContain('Ripple · 1 change → 6 dependents · 2 break · 1 to review')
})

test('a kept map whose changes are gone says nothing on the status line of a new session', async ($, on) => {
  const seen = world(on, { stored: { [STORE_KEY]: { ...SHOP_MAP, print: PRICE_PRINT } } })
  await start($)
  expect(seen.status.at(-1)).toBeUndefined()
  expect((await ripple($)).text).toStartWith('Ripple: nothing to map.')
})

test('the terminal draws the graph through its surface module, and the other surfaces draw the rings', async ($, on) => {
  await mapped($, on)

  const terminal = await mountPane($)
  expect(await mapRows(terminal)).toEqual(graphIn(PANE.bodyColumns).rows.map(rowText))
  expect(await terminal.find({ in: 'map', type: 'Text', text: /^● cart\.ts$/ })).toMatchObject({
    props: { color: 'error', bold: true, inverse: true },
  })
  expect(await terminal.find({ in: 'map', type: 'Text', text: /^◆ price\.ts$/ })).toMatchObject({
    props: { color: 'suggestion' },
  })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  await terminal.unmount()

  const header = 'Ripple · 1 change → 6 dependents · 2 break · 1 to review'
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const rings = await $.ui.mount({ plugin: 'ripple', surface, component: 'Pane', requestId: 'ripple', props: PANE })
    const svg = await rings.find({ type: 'Svg' })
    expect(svg?.props).toMatchObject({ alt: header, isInteractive: true, width: 720, height: 720 })
    expect(String(svg?.props.source)).toStartWith('<svg ')
    expect(await rings.find({ type: 'Client' })).toBeUndefined()
    await rings.unmount()
  }
})

test('under the map the pane lists the selected file\'s symbols with their lines, and says more of the selected one', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  expect(await selectedFile(pane)).toBe('src/cart.ts')
  expect(await pane.find({ type: 'Text', text: ' · 1 symbol · ' })).toBeDefined()
  expect(await pane.find({ type: 'Link' })).toMatchObject({
    props: { href: 'file:///repo/shop/src/cart.ts', label: 'open' },
  })
  expect(await rowsOf(pane, 'list')).toEqual(['  ● renderCart  :14  breaks · untested'])
  expect(await pane.find({ type: 'Text', text: ' · function · uses formatPrice · used by CheckoutPage' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'passes 1 argument; formatPrice now takes 2' })).toMatchObject({
    props: { color: 'error', wrap: 'wrap' },
  })
  await pane.unmount()
})

test('the keys under the map move from file to file, and next flagged goes round what is at risk', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  const after = async (key: string) => {
    await pane.press({ key })
    return selectedFile(pane)
  }
  expect(await after('l')).toBe('src/invoice.ts')
  expect(await after('k')).toBe('src/pages/invoice.ts')
  expect(await after('h')).toBe('src/pages/checkout.ts')
  expect(await after('j')).toBe('src/cart.ts')
  expect(await after('j')).toBe('src/price.ts')
  expect(await after('n')).toBe('src/cart.ts')
  expect(await after('n')).toBe('src/invoice.ts')
  expect(await after('n')).toBe('src/email.ts')
  expect(await pane.find({ in: 'map', type: 'Text', text: /^▲ email\.ts$/ })).toMatchObject({
    props: { inverse: true },
  })
  expect(await selectedSymbol(pane)).toBe('emailReceipt')
  await pane.unmount()
})

test('u and d move through the selected file\'s symbols and leave the file selected', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'j' })
  await pane.press({ key: 'j' })
  expect(await selectedFile(pane)).toBe('src/money.ts')
  expect(await rowsOf(pane, 'list')).toEqual(['  → currencySymbol  :3', '  → toFixed2        :9'])
  expect(await selectedSymbol(pane)).toBe('currencySymbol')

  await pane.press({ key: 'd' })
  expect(await selectedSymbol(pane)).toBe('toFixed2')
  expect(await pane.find({ type: 'Text', text: ' · function · used by formatPrice' })).toBeDefined()
  await pane.press({ key: 'd' })
  expect(await selectedSymbol(pane)).toBe('toFixed2')
  await pane.press({ key: 'u' })
  expect(await selectedSymbol(pane)).toBe('currencySymbol')
  expect(await selectedFile(pane)).toBe('src/money.ts')
  await pane.unmount()
})

test('a click on a box selects its file, and the arrow keys then move from there', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  const box = boxOf('emailReceipt')
  await pane.pointer({ type: 'down', x: box.x + 1, y: box.y + 1, button: 'left', in: 'map' })
  expect(await selectedFile(pane)).toBe('src/email.ts')

  await pane.key({ key: 'left', in: 'map' })
  expect(await selectedFile(pane)).toBe('src/ui.ts')
  await pane.key({ key: 'down', in: 'map' })
  expect(await selectedFile(pane)).toBe('src/price.ts')

  await pane.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'map' })
  await pane.pointer({ type: 'move', x: box.x + 1, y: box.y + 1, in: 'map' })
  await pane.pointer({ type: 'down', x: box.x + 1, y: box.y + 1, button: 'right', in: 'map' })
  expect(await selectedFile(pane)).toBe('src/price.ts')
  await pane.unmount()
})

test('a click on a row of the list selects that symbol, and up and down there go through the symbols', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  const box = boxOf('toFixed2')
  await pane.pointer({ type: 'down', x: box.x + 1, y: box.y + 1, button: 'left', in: 'map' })
  expect(await selectedSymbol(pane)).toBe('currencySymbol')

  await pane.pointer({ type: 'down', x: 4, y: 1, button: 'left', in: 'list' })
  expect(await selectedSymbol(pane)).toBe('toFixed2')
  await pane.key({ key: 'up', in: 'list' })
  expect(await selectedSymbol(pane)).toBe('currencySymbol')
  expect(await selectedFile(pane)).toBe('src/money.ts')

  await pane.key({ key: 'up', in: 'map' })
  expect(await selectedFile(pane)).toBe('src/price.ts')
  await pane.unmount()
})

test('a click on a count scrolls the map and leaves the selection alone; the next move brings the window back to it', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($, { ...PANE, bodyColumns: 44, scroll: { offset: 0, bodyRows: 60 } })
  const before = await mapRows(pane)
  expect(before).toEqual(graphIn(44).rows.map(rowText))
  expect(before.at(-1)).toBe('                                    2 more →')

  await pane.pointer({ type: 'down', x: 40, y: before.length - 1, button: 'left', in: 'map' })
  const scrolled = await mapRows(pane)
  expect(scrolled.at(-1)).toBe('← 2 more')
  expect(scrolled[6]).toBe('…c/invoice.ts │  │ ○ ui.ts │  │ ▲ email.ts │')
  expect(await selectedFile(pane)).toBe('src/cart.ts')

  await pane.press({ key: 'l' })
  expect(await selectedFile(pane)).toBe('src/invoice.ts')
  expect((await mapRows(pane))[6]).toContain('║ ● src/invoice.ts ║')
  await pane.unmount()
})

test('t switches between the graph and the tree, keeping the selection', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'l' })
  expect((await pane.find({ key: 't' }))?.props.label).toBe('tree view')

  await pane.press({ key: 't' })
  expect((await mapRows(pane))[0]).toStartWith('◆ src/price.ts')
  expect(await selectedFile(pane)).toBe('src/invoice.ts')
  expect((await pane.find({ key: 't' }))?.props.label).toBe('graph view')
  await pane.press({ key: 'j' })
  expect(await selectedFile(pane)).toBe('src/pages/invoice.ts')

  await pane.key({ key: 't', in: 'map' })
  expect((await mapRows(pane))[0]).toContain('┌')
  await pane.unmount()
})

test('with the view option set to tree, the map opens as a tree', { options: { view: 'tree' } }, async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  expect((await mapRows(pane))[0]).toStartWith('◆ src/price.ts')
  await pane.press({ key: 't' })
  expect((await mapRows(pane))[0]).toContain('┌')
  await pane.unmount()
})

test('a pane too narrow for the graph draws the tree', async ($, on) => {
  await mapped($, on)
  const narrow = await mountPane($, { ...PANE, bodyColumns: 36 })
  expect((await mapRows(narrow))[1]).toStartWith('├─ ● src/cart.ts')
  await narrow.unmount()
})

test('a short pane keeps to the header, the map as a tree, the list, the reason, and the keys', async ($, on) => {
  await mapped($, on)
  const short = await mountPane($, { ...PANE, bodyColumns: 96, scroll: { offset: 0, bodyRows: 12 } })
  const texts = (await short.findAll({ type: 'Text' })).map(found => found.text)
  expect(texts).toContain('Ripple · 1 change → 6 dependents · 2 break · 1 to review')
  expect(texts).not.toContain(SHOP_MAP.summary)
  expect(texts).not.toContain('uncommitted changes · via LSP')
  expect(texts).not.toContain('◆ changed')
  expect(texts).not.toContain(' · function · uses formatPrice · used by CheckoutPage')
  expect(await rowsOf(short, 'list')).toEqual(['  ● renderCart  :14  breaks · untested'])
  expect(await short.find({ type: 'Text', text: 'passes 1 argument; formatPrice now takes 2' })).toMatchObject({
    props: { color: 'error', wrap: 'truncate-end' },
  })

  const rows = await mapRows(short)
  expect(rows).toHaveLength(5)
  expect(rows[0]).toStartWith('◆ src/price.ts')
  expect(rows.at(-1)?.trim()).toBe('↓ 4 more')

  expect(await short.find({ key: 't' })).toBeUndefined()
  await short.press({ key: 'j' })
  expect(await selectedFile(short)).toBe('src/pages/checkout.ts')
  await short.unmount()
})

test('the pane asks for the keyboard when the person opens it, and never when a map arrives', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await report($, 'mapper-1')
  expect(seen.askedFocus).toEqual([true, false])
})

test('every letter the pane binds only moves the view: what starts a turn, a mapper, or a browser is a digit', async ($, on) => {
  const seen = await mapped($, on)
  const pane = await mountPane($)
  const keys = (await pane.findAll({ type: 'Button' })).map(button => button.key ?? '')
  expect(keys).toEqual(['h', 'j', 'k', 'l', 'u', 'd', 'n', 't', '1', '2', '3'])
  for (const key of keys.filter(one => /^[a-z]$/.test(one))) await pane.press({ key })
  expect(seen.prompts).toEqual([])
  expect(seen.spawned).toHaveLength(1)
  expect(seen.files.size).toBe(0)
  await pane.unmount()
})

test('no part of the pane moves as the selection does, however many symbols a file holds or much is said of one', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($, { ...PANE, bodyColumns: 60, scroll: { offset: 0, bodyRows: 30 } })
  const heights = async (): Promise<unknown[]> => [
    (await mapRows(pane)).length,
    (await pane.findAll({ type: 'Box' })).map(box => box.props.height).filter(height => height !== undefined),
  ]
  const before = await heights()
  expect(await selectedFile(pane)).toBe('src/cart.ts')
  expect(before[1]).toEqual([5])
  for (const key of ['j', 'j']) await pane.press({ key })
  expect(await selectedFile(pane)).toBe('src/money.ts')
  expect(await heights()).toEqual(before)
  await pane.unmount()
})

test('a map of changes that touch no symbol can still be made again', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await report($, 'mapper-1', { method: 'grep', summary: 'Only comments changed.', nodes: [], edges: [] })
  seen.statusOf.set('mapper-1', 'completed')

  const pane = await mountPane($)
  expect((await pane.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['2'])
  expect(await pane.find({ type: 'Client' })).toBeUndefined()
  await pane.press({ key: '2' })
  expect(seen.spawned).toHaveLength(2)
  await pane.unmount()
})

test('a mapper the engine refuses to start is said to be refused, and nothing waits on it', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  seen.spawnRefusal = 'agents are disabled'
  await start($)
  expect((await ripple($)).text).toBe('Ripple: could not start the mapper (agents are disabled).')
  expect(seen.status.at(-1)).toBeUndefined()
  expect(seen.opened).toEqual([])
})

test('where the surface has no room for the pane when a map arrives, a toast says how to open it', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  seen.isPlaced = false
  await report($, 'mapper-1')
  expect(seen.toasts.at(-1)).toBe('Ripple: the map is ready. Run /ripple to open it.')
})

test('asking Claude puts a question about the selected symbol to the conversation', async ($, on) => {
  const seen = await mapped($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'l' })
  await pane.press({ key: '1' })
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toStartWith(
    "The person is looking at Ripple's map of the uncommitted changes and asks about renderInvoice at src/invoice.ts:11",
  )
  expect(seen.prompts[0]).toEndWith('Do not edit any files.')
  await pane.unmount()
})

test('re-map starts a fresh mapper on changes already mapped, and its map starts the selection over', async ($, on) => {
  const seen = await mapped($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'j' })
  expect(await selectedFile(pane)).toBe('src/price.ts')

  await pane.press({ key: '2' })
  expect(seen.spawned).toHaveLength(2)
  expect(seen.status.at(-1)).toBe('mapping…')
  await report($, 'mapper-2')
  expect(await selectedFile(pane)).toBe('src/cart.ts')
  await pane.unmount()
})

test('/ripple web writes the page and opens it', async ($, on) => {
  const seen = world(on, { isWindows: true })
  seen.diff = PRICE_DIFF
  await start($)
  expect((await ripple($, 'web')).text).toBe('Ripple: no map to export yet. Run /ripple first.')
  expect(seen.files.size).toBe(0)

  await ripple($)
  await report($, 'mapper-1')
  expect(await ripple($, ' WEB ')).toEqual({ text: 'Ripple: opened .ripple/graph.html' })
  const [[path, page] = []] = [...seen.files]
  expect(path).toEndWith('/repo/shop/.ripple/graph.html')
  expect(page).toStartWith('<!doctype html>')
  expect(seen.ran).toEqual([['rundll32', 'url.dll,FileProtocolHandler', '\\repo\\shop\\.ripple\\graph.html']])
})

test('/ripple reset clears the map, the wait, and the pane', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await report($, 'mapper-1')
  await ripple($, 'renderCart')
  expect(seen.status.at(-1)).toBe('mapping…')

  expect(await ripple($, 'reset')).toEqual({ text: 'Ripple: cleared the map.' })
  expect(seen.status.at(-1)).toBeUndefined()
  expect(seen.closed).toEqual(['ripple'])
  expect(seen.stored.has(STORE_KEY)).toBe(false)
  expect((await report($, 'mapper-2')).deny).toContain('Only the mapper')
})

test('where the system has no Windows opener, the page is opened with the first opener that works', async ($, on) => {
  const seen = await mapped($, on)
  expect(await ripple($, 'web')).toEqual({ text: 'Ripple: opened .ripple/graph.html' })
  expect(seen.ran).toEqual([['open', '/repo/shop/.ripple/graph.html']])
})
