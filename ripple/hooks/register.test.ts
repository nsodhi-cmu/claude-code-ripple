import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { DEMO_MAP } from './demo'
import { MAPPING_MARKER } from './model'

// The whole loop through the engine: an edit is tracked, /ripple asks Claude
// to map, the report tool saves the map and answers, an edit to a flagged
// caller turns it green, and the pane draws all of it on every surface.

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

/** The demo map as Claude would report it: no `isDemo`. */
const REPORT = { method: DEMO_MAP.method, nodes: DEMO_MAP.nodes, edges: DEMO_MAP.edges }

/** Where the stand-in Edit tool says each file changed. */
const CHANGED_LINE: Record<string, number> = { 'price.ts': 1, 'cart.ts': 14, 'ui.ts': 300 }

/**
 * Stands in for everything beneath the plugin: the tools, the store, the clock
 * and the surface. Returns what the plugin did to each.
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
    seen.ran.push([...e.argv])
    return {
      value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  // The engine's own spinner, which the plugin reads the word of and passes on.
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: e.props.word })
  })
  // The Edit tool itself: answers with a patch that changes one line.
  on('tool.call', { tool: 'Edit' }, ($, e) => {
    seen.edited += 1
    const name = e.file_path.replaceAll('\\', '/').split('/').pop() ?? ''
    const line = CHANGED_LINE[name] ?? 3
    return {
      result: {
        filePath: e.file_path,
        oldString: e.old_string,
        newString: e.new_string,
        originalFile: null,
        structuredPatch: [
          {
            oldStart: line,
            oldLines: 2,
            newStart: line,
            newLines: 2,
            lines: ['-old', `+${e.new_string}`, ' c'],
          },
        ],
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

const edit = ($: Engine, file: string, text: string) =>
  $.tool.call({ tool: 'Edit', file_path: `C:\\repo\\shop\\src\\${file}`, old_string: 'old', new_string: text })

test('session start registers the report tool in the prompt and /ripple', async ($, on) => {
  const { seen } = world(on)
  await start($)
  expect(seen.tools).toEqual([{ name: 'report', isDeferred: false }])
  expect(seen.commands).toEqual(['ripple'])
  expect(seen.status.at(-1)).toBeUndefined()
})

test('an edit is tracked on the status line, and the tool result passes through', async ($, on) => {
  const { seen } = world(on)
  await start($)
  const ran = await edit($, 'price.ts', 'export function formatPrice(amount: number, currency: string): string {')
  expect(ran.result).toMatchObject({ filePath: 'C:\\repo\\shop\\src\\price.ts' })
  expect(seen.status.at(-1)).toBe('ripple: 1 edit · 1 file · /ripple to map')
  await edit($, 'price.ts', 'return currencySymbol(currency) + toFixed2(amount)')
  await edit($, 'ui.ts', 'x')
  expect(seen.status.at(-1)).toBe('ripple: 3 edits · 2 files · /ripple to map')
})

test('/ripple with no edits says so and asks the model nothing', async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  expect(await ripple($)).toEqual({})
  await clock.advance(SUBMIT_AFTER_MS)
  expect(seen.toasts).toEqual(['Ripple: no edits to map yet.'])
  expect(seen.prompts).toEqual([])
  expect(seen.opened).toEqual([])
})

test('the loop: map, report, fix a caller, see it turn green', async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  await edit($, 'price.ts', 'export function formatPrice(amount: number, currency: string): string {')

  // /ripple asks Claude to map and opens the pane at once.
  expect(await ripple($)).toEqual({})
  expect(seen.prompts).toEqual([])
  await clock.advance(SUBMIT_AFTER_MS)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toStartWith(MAPPING_MARKER)
  expect(seen.prompts[0]).toContain(
    '- src/price.ts:1: `export function formatPrice(amount: number, currency: string): string {`',
  )
  expect(seen.toasts.at(-1)).toBe('Ripple: mapping 1 edit…')
  expect(seen.status.at(-1)).toBe('ripple: mapping…')
  expect(seen.opened).toEqual(['ripple'])

  const waiting = await $.ui.mount({ plugin: 'ripple', surface: 'terminal', component: 'Pane', requestId: 'ripple', props: PANE })
  expect(await waiting.find({ type: 'Text', text: /Mapping…/ })).toBeDefined()
  await waiting.unmount()

  // Claude reports; the result tells it what to check.
  const reported = await $.tool.call({ tool: 'mcp__ripple__report', ...REPORT })
  expect(String(reported.result)).toStartWith('Ripple map shown to the user: 1 changed, 6 callers, 3 need review.')
  expect(String(reported.result)).toContain('- renderCart (src/cart.ts:14): passes 1 argument; formatPrice now takes 2')
  expect(seen.status.at(-1)).toBe('ripple: 3 need review · /ripple show')
  expect(seen.edited).toBe(1)

  const ui = await $.ui.mount({ plugin: 'ripple', surface: 'terminal', component: 'Pane', requestId: 'ripple', props: PANE })
  expect(await ui.find({ type: 'Text', text: 'Ripple · 1 change → 6 callers · 3 need review · via LSP' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Mapping…/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^● renderCart$/ })).toMatchObject({ props: { color: 'error', bold: true } })
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props.label)).toEqual([
    'Check renderCart',
    'Check renderInvoice',
    'Check emailReceipt',
    'Re-map',
    'Open in browser',
  ])

  // Claude fixes renderCart: the node turns green with no re-map.
  await edit($, 'cart.ts', 'return formatPrice(total, cart.currency)')
  expect(seen.status.at(-1)).toBe('ripple: 2 need review · 1 edit · 1 file · /ripple to map')
  expect(await ui.find({ type: 'Text', text: /^✓ renderCart$/ })).toMatchObject({ props: { color: 'success' } })
  expect(await ui.find({ type: 'Text', text: /^● renderCart$/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props.label)).toEqual([
    'Check renderInvoice',
    'Check emailReceipt',
    'Re-map',
    'Open in browser',
  ])

  // An edit far from any flagged caller changes nothing on the map.
  await edit($, 'ui.ts', 'unrelated')
  expect(seen.status.at(-1)).toBe('ripple: 2 need review · 2 edits · 2 files · /ripple to map')
  await ui.unmount()
})

test('a Check button asks Claude about that caller; Re-map maps again', async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  await $.tool.call({ tool: 'mcp__ripple__report', ...REPORT })
  const ui = await $.ui.mount({ plugin: 'ripple', surface: 'terminal', component: 'Pane', requestId: 'ripple', props: PANE })

  await ui.press({ key: 'check-2' })
  await clock.settle()
  expect(seen.prompts).toEqual([
    'Check renderInvoice at src/invoice.ts:11 against the change to formatPrice; fix it if needed. Ripple flagged it: passes 1 argument; invoice.currency is not passed',
  ])

  await ui.press({ key: 'remap' })
  await clock.advance(SUBMIT_AFTER_MS)
  expect(seen.prompts).toHaveLength(2)
  expect(seen.prompts[1]).toContain('trace these again too:\n- formatPrice (src/price.ts:1)')
  expect(await ui.find({ type: 'Text', text: /Mapping…/ })).toBeDefined()
  await ui.unmount()
})

test('a mapping turn that ends with no report stops the spinner', async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  await edit($, 'price.ts', 'x')
  await ripple($)
  await clock.advance(SUBMIT_AFTER_MS)

  await $.turn.start({ text: seen.prompts[0] ?? '', turnId: 'turn-1' })
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, reason: 'aborted', turnId: 'turn-1' })
  expect(seen.toasts.at(-1)).toBe('Ripple: mapping ended without a map. Run /ripple to try again.')
  expect(seen.status.at(-1)).toBe('ripple: 1 edit · 1 file · /ripple to map')
})

test('a second /ripple while one is mapping does not ask twice', async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  await edit($, 'price.ts', 'x')
  await ripple($)
  await clock.advance(SUBMIT_AFTER_MS)
  await ripple($)
  await clock.advance(5_000)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.toasts.at(-1)).toBe('Ripple: already mapping.')
})

test("the pane's Mapping line carries the spinner's word, and the spinner is left alone", async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  await edit($, 'price.ts', 'x')
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

  const pane = await $.ui.mount({ plugin: 'ripple', surface: 'terminal', component: 'Pane', requestId: 'ripple', props: PANE })
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

test('a reported map is kept for the next session', async ($, on) => {
  const { seen } = world(on)
  await start($)
  await $.tool.call({ tool: 'mcp__ripple__report', ...REPORT })
  expect(seen.store.get(`map:${ROOT}`)).toMatchObject({ method: 'lsp', edges: DEMO_MAP.edges })
})

test('the next session starts with the map the last one kept', async ($, on) => {
  const { seen } = world(on)
  seen.store.set(`map:${ROOT}`, REPORT)
  await start($)
  expect(seen.status.at(-1)).toBe('ripple: 3 need review · /ripple show')
  const ui = await $.ui.mount({ plugin: 'ripple', surface: 'terminal', component: 'Pane', requestId: 'ripple', props: PANE })
  expect(await ui.find({ type: 'Text', text: /^● renderCart$/ })).toBeDefined()
  await ui.unmount()
})

test('/ripple demo draws the canned map on every surface, with no model call', async ($, on) => {
  const { seen, clock } = world(on)
  await start($)
  expect(await ripple($, 'demo')).toEqual({})
  await clock.settle()
  expect(seen.prompts).toEqual([])
  expect(seen.opened).toEqual(['ripple'])
  expect(seen.store.has(`map:${ROOT}`)).toBe(false)
  const header = 'Ripple · 1 change → 6 callers · 3 need review · via LSP · demo'

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
  await ripple($, 'web')
  expect(seen.files.size).toBe(0)
  expect(seen.toasts.at(-1)).toContain('no map to export yet')

  await ripple($, 'demo')
  await ripple($, ' WEB ')
  expect([...seen.files.keys()]).toEqual([`${ROOT}/.ripple/graph.html`])
  expect(seen.files.get(`${ROOT}/.ripple/graph.html`)).toStartWith('<!doctype html>')
  expect(seen.ran).toEqual([['rundll32', 'url.dll,FileProtocolHandler', 'C:\\repo\\shop\\.ripple\\graph.html']])
  expect(seen.toasts.at(-1)).toBe('Ripple: opened .ripple/graph.html')
})

test('/ripple reset clears the edits, the map and the pane', async ($, on) => {
  const { seen } = world(on)
  await start($)
  await edit($, 'price.ts', 'x')
  await $.tool.call({ tool: 'mcp__ripple__report', ...REPORT })
  await edit($, 'ui.ts', 'y')
  await ripple($, 'reset')
  expect(seen.status.at(-1)).toBeUndefined()
  expect(seen.closed).toEqual(['ripple'])
  expect(seen.store.has(`map:${ROOT}`)).toBe(false)

  await ripple($, 'show')
  expect(seen.toasts.at(-1)).toContain('no map yet')
  await ripple($, 'nonsense')
  expect(seen.toasts.at(-1)).toContain('/ripple maps recent edits')
})
