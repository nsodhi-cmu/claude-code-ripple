import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, RenderPropsOf } from 'claude-code'

import { SHOP_MAP, SHOP_REPORT } from './fixture'
import { HEAD, readChanges } from '../hooks/changes'
import { rowText } from '../hooks/draw'
import { NO_ASKING } from '../hooks/mapper'
import { drawView } from '../hooks/view'

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

/**
 * Stands in for everything beneath the plugin: git, the store, the agents
 * and the surface. Returns what the plugin did to each.
 */
const world = (on: On, stored: Record<string, unknown> = {}) => {
  const seen = {
    status: [] as Array<string | undefined>,
    toasts: [] as string[],
    prompts: [] as string[],
    opened: [] as string[],
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
    /** What `git ls-files --others` answers. */
    untracked: '',
    /** The default branch as `origin/HEAD` names it; '' when the repository has none. */
    defaultBranch: '',
    isRepository: true,
    /** How the agents the plugin started stand; a spawned one runs until a test says otherwise. */
    statusOf: new Map<string, AgentInfo['status']>(),
    stored: new Map<string, unknown>(Object.entries(stored)),
  }
  mock.clock(on)
  mock.env(on, { OS: 'Windows_NT' })

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
  // The kit hands a plugin's spawn on as the Agent tool's call, and reads the
  // agent it started off that tool's result.
  on('agent.spawn', ($, e) => {
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
  on('tool.check', ($, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
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
    return { value: { isPlaced: true } }
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
    if (rest.includes('diff')) return answer(seen.diff)
    if (rest.includes('ls-files')) return answer(seen.untracked)
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

/** The rows the map's surface module drew. */
const mapRows = async (pane: Pane): Promise<string[]> => {
  const drawn = (await pane.drawn({ in: 'map' })) as { children?: Array<{ children?: unknown[] }> }
  return (drawn.children ?? []).map(row =>
    (row.children ?? [])
      .map(span => (typeof span === 'string' ? span : ((span as { children?: string[] }).children ?? []).join('')))
      .join(''),
  )
}

/** The name the detail under the map leads with: the selected node's. */
const selectedName = async (pane: Pane): Promise<string | undefined> =>
  (await pane.find({ type: 'Text', text: /^▸ \S+$/ }))?.text.slice(2)

/** A room as wide as the pane and taller than the shop's graph, which the pane's own room for the map is too. */
const ROOM = { columns: PANE.bodyColumns, rows: PANE.scroll.bodyRows }
const hitOf = (name: string) => {
  const node = SHOP_MAP.nodes.find(one => one.name === name)
  const hit = drawView(SHOP_MAP, 'graph', null, ROOM).hits.find(one => one.id === node?.id)
  if (hit === undefined) throw new Error(`${name} is not drawn`)
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

test('the loop: /ripple starts a mapper on the uncommitted diff, and its report becomes the map of those changes', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  seen.untracked = 'src/fresh.ts\n'
  await start($)

  expect(await ripple($, 'formatPrice')).toEqual({})
  expect(seen.git).toEqual([
    ['-c', 'core.quotePath=false', 'diff', 'HEAD', '--relative', '--unified=0', '--no-color', '--no-ext-diff'],
    ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard'],
  ])
  expect(seen.spawned).toHaveLength(1)
  expect(seen.spawned[0]?.subagentType).toBe('ripple:mapper')
  expect(seen.spawned[0]?.prompt).toContain('Read them with `git diff HEAD`.')
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
  expect(drawn).toContain('▸ renderCart')

  // The mapper's turn ends after its report: nothing more is said.
  const toasts = seen.toasts.length
  await turnEnds($, 'mapper-1')
  expect(seen.toasts).toHaveLength(toasts)
})

test('a report from anyone but the mapper Ripple started is refused', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)

  const unasked = await $.tool.call({ tool: 'mcp__ripple__report', ...SHOP_REPORT })
  expect(unasked.deny).toContain('Only the mapper Ripple starts reports a map.')

  await ripple($)
  expect((await report($, 'someone-else')).deny).toContain('Only the mapper Ripple starts')
  expect(seen.stored.has(STORE_KEY)).toBe(false)
  expect((await report($, 'mapper-1')).deny).toBeUndefined()
  // Its one report is in: the same mapper cannot replace the map.
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
    ['-c', 'core.quotePath=false', 'diff', MERGE_BASE, '--relative', '--unified=0', '--no-color', '--no-ext-diff'],
    ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard'],
  ])
  expect(seen.spawned[0]?.prompt).toStartWith(
    `Map what this branch changed since it left main, uncommitted changes included.\nRead them with \`git diff ${MERGE_BASE}\`.`,
  )
  await report($, 'mapper-1')
  expect(seen.stored.get(STORE_KEY)).toMatchObject({ scope: 'branch', base: 'main' })
  expect(await paneText($)).toContain('branch since main · via LSP')

  // The same diff under the other scope is not the same map.
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

test('the mapper never asks: what would raise a dialog is refused for it, and for it alone', async ($, on) => {
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  const check = (tool: string, agentId?: string) =>
    $.tool.check({ tool, input: {}, ...(agentId === undefined ? {} : { agentId }) })

  expect(await check('Bash', 'mapper-1')).toEqual({ decision: 'deny', reason: NO_ASKING })
  expect(await check('Read', 'mapper-1')).toEqual({ decision: 'allow' })
  expect(await check('Bash', 'another-agent')).toEqual({ decision: 'ask' })
  expect(await check('Bash')).toEqual({ decision: 'ask' })

  // Once its report is in, it is no longer Ripple's mapper.
  await report($, 'mapper-1')
  expect(await check('Bash', 'mapper-1')).toEqual({ decision: 'ask' })
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
  const seen = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await report($, 'mapper-1')
  const stale = 'The changes have moved on since this map · /ripple to map them again'

  await turnEnds($)
  expect(await paneText($)).not.toContain(stale)

  seen.diff = PRICE_DIFF + CART_DIFF
  await turnEnds($)
  expect(await paneText($)).toContain(stale)

  seen.diff = PRICE_DIFF
  await turnEnds($)
  expect(await paneText($)).not.toContain(stale)
})

test('a map kept from an earlier session comes back at session start', async ($, on) => {
  const seen = world(on, { [STORE_KEY]: { ...SHOP_MAP, print: PRICE_PRINT } })
  seen.diff = PRICE_DIFF
  await start($)
  expect(seen.status.at(-1)).toBe('2 break · 1 to review · /ripple')
  expect(await ripple($)).toEqual({})
  expect(seen.spawned).toEqual([])
  expect(await paneText($)).toContain('Ripple · 1 change → 6 dependents · 2 break · 1 to review')
})

test('the terminal draws the graph through its surface module, and the other surfaces draw the rings', async ($, on) => {
  await mapped($, on)

  const terminal = await mountPane($)
  expect(await mapRows(terminal)).toEqual(drawView(SHOP_MAP, 'graph', null, ROOM).rows.map(rowText))
  expect(await terminal.find({ in: 'map', type: 'Text', text: /^● renderCart$/ })).toMatchObject({
    props: { color: 'error', bold: true, inverse: true },
  })
  expect(await terminal.find({ in: 'map', type: 'Text', text: /^◆ formatPrice$/ })).toMatchObject({
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

test('the detail under the map is of the selected node, and links to its file', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  expect(await selectedName(pane)).toBe('renderCart')
  expect(await pane.find({ type: 'Link' })).toMatchObject({
    props: { href: 'file:///repo/shop/src/cart.ts', label: 'src/cart.ts:14' },
  })
  expect(await pane.find({ type: 'Text', text: 'breaks: passes 1 argument; formatPrice now takes 2' })).toMatchObject({
    props: { color: 'error' },
  })
  expect(await pane.find({ type: 'Text', text: 'uses formatPrice · used by CheckoutPage' })).toBeDefined()
  await pane.unmount()
})

test('the keys under the map move the selection, and next flagged goes round what is at risk', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  const after = async (key: string) => {
    await pane.press({ key })
    return selectedName(pane)
  }
  expect(await after('l')).toBe('renderInvoice')
  expect(await after('k')).toBe('InvoicePage')
  expect(await after('h')).toBe('CheckoutPage')
  expect(await after('j')).toBe('renderCart')
  expect(await after('j')).toBe('formatPrice')
  expect(await after('n')).toBe('renderCart')
  expect(await after('n')).toBe('renderInvoice')
  expect(await after('n')).toBe('emailReceipt')
  // The map is drawn again around each selection.
  expect(await pane.find({ in: 'map', type: 'Text', text: /^▲ emailReceipt$/ })).toMatchObject({
    props: { inverse: true },
  })
  await pane.unmount()
})

test('a click on a box selects it, and the arrow keys then move from there', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  const box = hitOf('emailReceipt')
  await pane.pointer({ type: 'down', x: box.x + 1, y: box.y + 1, button: 'left' })
  expect(await selectedName(pane)).toBe('emailReceipt')

  await pane.key({ key: 'left' })
  expect(await selectedName(pane)).toBe('priceLabel')
  await pane.key({ key: 'down' })
  expect(await selectedName(pane)).toBe('formatPrice')

  // Neither a click on empty room nor a move of the pointer selects anything.
  await pane.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
  await pane.pointer({ type: 'move', x: box.x + 1, y: box.y + 1 })
  await pane.pointer({ type: 'down', x: box.x + 1, y: box.y + 1, button: 'right' })
  expect(await selectedName(pane)).toBe('formatPrice')
  await pane.unmount()
})

test('t switches between the graph and the tree, keeping the selection', async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'l' })
  expect((await pane.find({ key: 't' }))?.props.label).toBe('tree view')

  await pane.press({ key: 't' })
  expect((await mapRows(pane))[0]).toStartWith('◆ formatPrice')
  expect(await selectedName(pane)).toBe('renderInvoice')
  expect((await pane.find({ key: 't' }))?.props.label).toBe('graph view')
  // Down is the next row here, not the layer below.
  await pane.press({ key: 'j' })
  expect(await selectedName(pane)).toBe('InvoicePage')

  await pane.key({ key: 't' })
  expect((await mapRows(pane))[0]).toContain('┌')
  await pane.unmount()
})

test('with the view option set to tree, the map opens as a tree', { options: { view: 'tree' } }, async ($, on) => {
  await mapped($, on)
  const pane = await mountPane($)
  expect((await mapRows(pane))[0]).toStartWith('◆ formatPrice')
  await pane.press({ key: 't' })
  expect((await mapRows(pane))[0]).toContain('┌')
  await pane.unmount()
})

test('a pane too narrow for the graph draws the tree', async ($, on) => {
  await mapped($, on)
  const narrow = await mountPane($, { ...PANE, bodyColumns: 36 })
  expect((await mapRows(narrow))[1]).toStartWith('├─ ● renderCart')
  await narrow.unmount()
})

test('a short pane keeps to the header, the map as a tree, the selected node, and the keys', async ($, on) => {
  await mapped($, on)
  const short = await mountPane($, { ...PANE, bodyColumns: 96, scroll: { offset: 0, bodyRows: 12 } })
  const texts = (await short.findAll({ type: 'Text' })).map(found => found.text)
  expect(texts).toContain('Ripple · 1 change → 6 dependents · 2 break · 1 to review')
  expect(texts).not.toContain(SHOP_MAP.summary)
  expect(texts).not.toContain('uncommitted changes · via LSP')
  expect(texts).not.toContain('◆ changed')
  expect(texts).toContain('breaks: passes 1 argument; formatPrice now takes 2')

  // Header, a line each for the selected node and its verdict, one row of keys: eight rows are the map's.
  const rows = await mapRows(short)
  expect(rows).toHaveLength(8)
  expect(rows[1]).toStartWith('◆ formatPrice')
  expect(rows.at(-1)).toBe('↓ 3 more below')

  // The room has no graph to switch to, and down means the next row.
  expect(await short.find({ key: 't' })).toBeUndefined()
  await short.press({ key: 'j' })
  expect(await selectedName(short)).toBe('CheckoutPage')
  await short.unmount()
})

test('asking Claude puts a question about the selected node to the conversation', async ($, on) => {
  const seen = await mapped($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'l' })
  await pane.press({ key: 'a' })
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toStartWith('Ripple mapped my uncommitted changes. Look at renderInvoice at src/invoice.ts:11')
  expect(seen.prompts[0]).toEndWith('Do not edit any files.')
  await pane.unmount()
})

test('re-map starts a fresh mapper on changes already mapped, and its map starts the selection over', async ($, on) => {
  const seen = await mapped($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'j' })
  expect(await selectedName(pane)).toBe('formatPrice')

  await pane.press({ key: 'r' })
  expect(seen.spawned).toHaveLength(2)
  expect(seen.status.at(-1)).toBe('mapping…')
  await report($, 'mapper-2')
  expect(await selectedName(pane)).toBe('renderCart')
  await pane.unmount()
})

test('/ripple web writes the page and opens it', async ($, on) => {
  const seen = world(on)
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
