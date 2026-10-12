import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { SHOP_MAP } from './fixture'
import { MAPPING_MARKER, printOf } from '../hooks/model'

// The whole loop through the engine. Ripple reads the working tree from git
// and nothing else: /ripple asks Claude to map the uncommitted changes, the
// report tool saves the map and answers, a later change to a flagged caller
// turns it green, and the pane draws all of it on every surface.

const ROOT = 'C:/repo/shop'
/** Past the first of the plugin's submit timers. */
const SUBMIT_AFTER_MS = 200

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
/** A fix to the flagged caller renderCart, at its call on line 14. */
const CART_DIFF = fileDiff('src/cart.ts', 14, '  return formatPrice(total, cart.currency)')
/** A change far from any flagged caller. */
const UI_DIFF = fileDiff('src/ui.ts', 300, 'unrelated')

/**
 * Stands in for everything beneath the plugin: git, the store, the clock and
 * the surface. Returns what the plugin did to each.
 */
const world = (on: On) => {
  const seen = {
    status: [] as Array<string | undefined>,
    toasts: [] as string[],
    prompts: [] as string[],
    opened: [] as string[],
    closed: [] as string[],
    tools: [] as Array<{ name: string; isDeferred: unknown }>,
    commands: [] as string[],
    files: new Map<string, string>(),
    ran: [] as string[][],
    git: [] as string[][],
    /** What `git diff HEAD` answers: the working tree's uncommitted changes. */
    diff: '',
    /** What `git ls-files --others` answers: files git does not track yet. */
    untracked: '',
    store: new Map<string, unknown>(),
    edited: 0,
  }
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { OS: 'Windows_NT' })

  on('store.get', ($, e) => ({ value: seen.store.get(e.key) }))
  on('store.set', ($, e) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    seen.store.delete(e.key)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.register', ($, e) => {
    seen.tools.push({ name: e.name, isDeferred: e.isDeferred })
    return { value: { tool: `mcp__ripple__${e.name}` } }
  })
  on('command.register', ($, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
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
    const isGit = e.argv[0] === 'git'
    if (isGit) seen.git.push([...e.argv])
    else seen.ran.push([...e.argv])
    const stdout = !isGit ? '' : e.argv[1] === 'diff' ? seen.diff : seen.untracked
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // The engine's own spinner, which the plugin reads the word of and passes on.
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: e.props.word })
  })
  // The Edit tool itself. Ripple does not hook it: the call must come straight here.
  on('tool.call', { tool: 'Edit' }, ($, e) => {
    seen.edited += 1
    return {
      result: {
        filePath: e.file_path,
        oldString: e.old_string,
        newString: e.new_string,
        originalFile: null,
        structuredPatch: [],
        userModified: false,
        replaceAll: false,
      },
    }
  })
  return { seen, clock }
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

/** One turn of Claude's, from start to end; whatever it changed is in `seen.diff` by then. */
const turn = async ($: Engine, id: string, text = 'do something') => {
  await $.turn.start({ text, turnId: id })
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, reason: 'answer', turnId: id })
}

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'ripple', surface: 'terminal', component: 'Pane', requestId: 'ripple', props: PANE })

test('session start registers the report tool and /ripple, and reads the tree', async ($, on) => {
  const { seen } = world(on)
  await start($)
  expect(seen.tools).toEqual([{ name: 'report', isDeferred: false }])
  expect(seen.commands).toEqual(['ripple'])
  expect(seen.status.at(-1)).toBeUndefined()
  expect(seen.git).toEqual([
    ['git', 'diff', 'HEAD', '--relative', '--unified=0', '--no-color', '--no-ext-diff'],
    ['git', 'ls-files', '--others', '--exclude-standard'],
  ])
})

test('uncommitted changes at session start are offered on the status line', async ($, on) => {
  const { seen } = world(on)
  seen.diff = PRICE_DIFF + UI_DIFF
  seen.untracked = 'src/new.ts\n'
  await start($)
  expect(seen.status.at(-1)).toBe('ripple: uncommitted changes in 3 files · /ripple to map')
})

test('/ripple with a clean tree says so in the transcript and asks the model nothing', async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  const answered = await ripple($)
  expect(answered.text).toStartWith('Ripple: nothing to map.')
  expect(answered.text).toContain('Git shows no uncommitted changes here')
  await clock.advance(SUBMIT_AFTER_MS)
  expect(seen.prompts).toEqual([])
  expect(seen.opened).toEqual([])
})

test('Ripple does not listen to Edit calls: only the diff counts', async ($, on) => {
  const { seen } = world(on)
  await start($)
  const before = seen.status.length
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\repo\\shop\\src\\price.ts', old_string: 'a', new_string: 'b' })
  expect(seen.edited).toBe(1)
  expect(seen.status.length).toBe(before)
  expect((await ripple($)).text).toStartWith('Ripple: nothing to map.')
})

test('the loop: /ripple maps the diff, Claude reports, a fix turns a caller green', async ($, on) => {
  const { seen, clock } = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  expect(seen.status.at(-1)).toBe('ripple: uncommitted changes in 1 file · /ripple to map')

  // /ripple asks Claude to map the diff and opens the pane at once.
  expect(await ripple($)).toEqual({})
  expect(seen.prompts).toEqual([])
  await clock.advance(SUBMIT_AFTER_MS)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toStartWith(MAPPING_MARKER)
  expect(seen.prompts[0]).toContain('Uncommitted changes in the working tree (from `git diff HEAD`')
  expect(seen.prompts[0]).toContain(
    '- src/price.ts:1: `export function formatPrice(amount: number, currency: string): string {`',
  )
  expect(seen.toasts.at(-1)).toBe('Ripple: mapping uncommitted changes in 1 file…')
  expect(seen.status.at(-1)).toBe('ripple: mapping…')
  expect(seen.opened).toEqual(['ripple'])

  const waiting = await mountPane($)
  expect(await waiting.find({ type: 'Text', text: /Mapping…/ })).toBeDefined()
  await waiting.unmount()

  // Claude reports; the result tells it what to check.
  const reported = await $.tool.call({ tool: 'mcp__ripple__report', ...SHOP_MAP })
  expect(String(reported.result)).toStartWith('Ripple map shown to the user: 1 changed, 6 callers, 3 need review.')
  expect(String(reported.result)).toContain('- renderCart (src/cart.ts:14): passes 1 argument; formatPrice now takes 2')
  expect(seen.status.at(-1)).toBe('ripple: 3 need review · /ripple to see the map')
  expect(seen.store.get(`map:${ROOT}`)).toMatchObject({ method: 'lsp', print: printOf(`${PRICE_DIFF}\n`) })

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: 'Ripple · 1 change → 6 callers · 3 need review · via LSP' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Mapping…/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /has changed since this map/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^● renderCart$/ })).toMatchObject({ props: { color: 'error', bold: true } })
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props.label)).toEqual([
    'Check renderCart',
    'Check renderInvoice',
    'Check emailReceipt',
    'Re-map',
    'Open in browser',
  ])

  // Claude fixes renderCart, however it does it: the new hunk turns the node green.
  seen.diff = PRICE_DIFF + CART_DIFF
  await turn($, 'turn-1')
  expect(seen.status.at(-1)).toBe('ripple: 2 need review · uncommitted changes in 2 files · /ripple to map')
  expect(await ui.find({ type: 'Text', text: /^✓ renderCart$/ })).toMatchObject({ props: { color: 'success' } })
  expect(await ui.find({ type: 'Text', text: /^● renderCart$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /has changed since this map/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props.label)).toEqual([
    'Check renderInvoice',
    'Check emailReceipt',
    'Re-map',
    'Open in browser',
  ])
  expect(seen.store.get(`map:${ROOT}`)).toMatchObject({ print: printOf(`${PRICE_DIFF}\n`) })

  // A change far from any flagged caller turns nothing.
  seen.diff = PRICE_DIFF + CART_DIFF + UI_DIFF
  await turn($, 'turn-2')
  expect(seen.status.at(-1)).toBe('ripple: 2 need review · uncommitted changes in 3 files · /ripple to map')
  expect(await ui.find({ type: 'Text', text: /^● renderInvoice$/ })).toBeDefined()
  await ui.unmount()
})

test('/ripple on a diff that is already mapped shows that map and asks the model nothing', async ($, on) => {
  const { seen, clock } = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await clock.advance(SUBMIT_AFTER_MS)
  await $.tool.call({ tool: 'mcp__ripple__report', ...SHOP_MAP })
  expect(seen.prompts).toHaveLength(1)

  expect(await ripple($)).toEqual({})
  await clock.advance(5_000)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.opened.length).toBeGreaterThan(1)

  // The diff moves on: the next /ripple maps again.
  seen.diff = PRICE_DIFF + UI_DIFF
  expect(await ripple($)).toEqual({})
  await clock.advance(SUBMIT_AFTER_MS)
  expect(seen.prompts).toHaveLength(2)
  expect(seen.prompts[1]).toContain('- src/ui.ts:300: `unrelated`')
})

test('the next session shows the kept map for the same diff without asking again', async ($, on) => {
  const { seen, clock } = world(on)
  seen.diff = PRICE_DIFF
  seen.store.set(`map:${ROOT}`, { ...SHOP_MAP, print: printOf(`${PRICE_DIFF}\n`) })
  await start($)
  expect(seen.status.at(-1)).toBe('ripple: 3 need review · /ripple to see the map')
  expect(await ripple($)).toEqual({})
  await clock.advance(5_000)
  expect(seen.prompts).toEqual([])
  expect(seen.opened).toEqual(['ripple'])
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /^● renderCart$/ })).toBeDefined()
  await ui.unmount()
})

test('a change made by a shell command mid-session is seen through git and mapped', async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  expect(seen.status.at(-1)).toBeUndefined()

  // Claude runs `sed` in a turn: no Edit call, but the tree has moved.
  seen.diff = fileDiff('crates/engine/src/game.rs', 40, '    fn drawGame(&self, frame: &mut Frame);')
  seen.untracked = 'notes/new.rs\n'
  await turn($, 'turn-1', 'rename gameDraw to drawGame')
  expect(seen.status.at(-1)).toBe('ripple: uncommitted changes in 2 files · /ripple to map')

  expect(await ripple($)).toEqual({})
  await clock.advance(SUBMIT_AFTER_MS)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('- crates/engine/src/game.rs:40: `fn drawGame(&self, frame: &mut Frame);`')
  expect(seen.prompts[0]).toContain('- notes/new.rs:1: `(new file, not yet tracked by git)`')
})

test('a Check button asks Claude about that caller; Re-map maps the same diff again', async ($, on) => {
  const { seen, clock } = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await $.tool.call({ tool: 'mcp__ripple__report', ...SHOP_MAP })
  const ui = await mountPane($)

  await ui.press({ key: 'check-2' })
  await clock.settle()
  expect(seen.prompts).toEqual([
    'Check renderInvoice at src/invoice.ts:11 against the change to formatPrice; fix it if needed. Ripple flagged it: passes 1 argument; invoice.currency is not passed',
  ])

  await ui.press({ key: 'remap' })
  await clock.advance(SUBMIT_AFTER_MS)
  expect(seen.prompts).toHaveLength(2)
  expect(seen.prompts[1]).toStartWith(MAPPING_MARKER)
  expect(await ui.find({ type: 'Text', text: /Mapping…/ })).toBeDefined()
  await ui.unmount()
})

test('a mapping turn that ends with no report stops the spinner', async ($, on) => {
  const { seen, clock } = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await clock.advance(SUBMIT_AFTER_MS)

  await $.turn.start({ text: seen.prompts[0] ?? '', turnId: 'turn-1' })
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, reason: 'aborted', turnId: 'turn-1' })
  expect(seen.toasts.at(-1)).toBe('Ripple: mapping ended without a map. Run /ripple to try again.')
  expect(seen.status.at(-1)).toBe('ripple: uncommitted changes in 1 file · /ripple to map')
})

test('a second /ripple while one is mapping does not ask twice', async ($, on) => {
  const { seen, clock } = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await clock.advance(SUBMIT_AFTER_MS)
  expect(await ripple($)).toEqual({ text: 'Ripple: already mapping.' })
  await clock.advance(5_000)
  expect(seen.prompts).toHaveLength(1)
})

test("the pane's Mapping line carries the spinner's word, and the spinner is left alone", async ($, on) => {
  const { seen, clock } = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await ripple($)
  await clock.advance(SUBMIT_AFTER_MS)
  await $.turn.start({ text: seen.prompts[0] ?? '', turnId: 'turn-1' })

  const spinner = await $.ui.mount({
    plugin: 'ripple',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
  })
  expect((await spinner.drawn()) as unknown).toEqual({ type: 'Text', children: ['Sauteing'] })

  const pane = await mountPane($)
  expect(await pane.find({ type: 'Text', text: '◌ Mapping… Sauteing…' })).toBeDefined()
  await pane.unmount()
  await spinner.unmount()
})

test('a report that cannot be read is refused, and Claude is told why', async ($, on) => {
  world(on)
  await start($)
  const refused = await $.tool.call({ tool: 'mcp__ripple__report', method: 'lsp', nodes: 'callers', edges: [] })
  expect(JSON.stringify(refused)).toContain('Ripple could not read the map: `nodes` must be an array.')
})

test('a reported map is drawn on every surface: a tree in the terminal, rings elsewhere', async ($, on) => {
  const { seen } = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await $.tool.call({ tool: 'mcp__ripple__report', ...SHOP_MAP })
  expect(seen.opened).toEqual(['ripple'])
  const header = 'Ripple · 1 change → 6 callers · 3 need review · via LSP'

  for (const columns of [100, 48]) {
    const tree = await $.ui.mount({
      plugin: 'ripple',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'ripple',
      props: { ...PANE, bodyColumns: columns },
    })
    expect(await tree.find({ type: 'Text', text: header })).toBeDefined()
    expect(await tree.find({ type: 'Text', text: /^◉ formatPrice$/ })).toMatchObject({ props: { color: 'warning' } })
    expect(await tree.find({ type: 'Text', text: 'calls → toFixed2, currencySymbol' })).toBeDefined()
    expect(await tree.find({ type: 'Svg' })).toBeUndefined()
    await tree.unmount()
  }

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const rings = await $.ui.mount({ plugin: 'ripple', surface, component: 'Pane', requestId: 'ripple', props: PANE })
    expect(await rings.find({ type: 'Text', text: header })).toBeDefined()
    const svg = await rings.find({ type: 'Svg' })
    expect(svg?.props).toMatchObject({ alt: header, isInteractive: true, width: 720, height: 720 })
    expect(String(svg?.props.source)).toStartWith('<svg ')
    expect(await rings.findAll({ type: 'Button' })).toHaveLength(5)
    await rings.unmount()
  }
})

test('/ripple web writes the page and opens it', async ($, on) => {
  const { seen } = world(on)
  await start($)
  expect((await ripple($, 'web')).text).toContain('no map to export yet')
  expect(seen.files.size).toBe(0)

  await $.tool.call({ tool: 'mcp__ripple__report', ...SHOP_MAP })
  expect(await ripple($, ' WEB ')).toEqual({ text: 'Ripple: opened .ripple/graph.html' })
  const [[path, page] = []] = [...seen.files]
  expect(path).toEndWith('/repo/shop/.ripple/graph.html')
  expect(page).toStartWith('<!doctype html>')
  expect(seen.ran).toEqual([['rundll32', 'url.dll,FileProtocolHandler', 'C:\\repo\\shop\\.ripple\\graph.html']])
})

test('/ripple reset clears the map and the pane; other words print the usage', async ($, on) => {
  const { seen } = world(on)
  seen.diff = PRICE_DIFF
  await start($)
  await $.tool.call({ tool: 'mcp__ripple__report', ...SHOP_MAP })
  expect(await ripple($, 'reset')).toEqual({ text: 'Ripple: cleared the map.' })
  expect(seen.status.at(-1)).toBe('ripple: uncommitted changes in 1 file · /ripple to map')
  expect(seen.closed).toEqual(['ripple'])
  expect(seen.store.has(`map:${ROOT}`)).toBe(false)

  expect((await ripple($, 'show')).text).toContain('/ripple maps your uncommitted changes')
})
