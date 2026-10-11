import { describe, expect, test } from 'claude-code/testing'

import type { RippleEdit, RippleMap } from '../types'
import { DEMO_MAP } from './demo'
import {
  MAPPING_MARKER,
  MAX_NODES,
  checkPrompt,
  countsOf,
  firstChangedLine,
  headerText,
  mappingPrompt,
  markUpdated,
  readPatch,
  relativeTo,
  reportText,
  sameFile,
  sanitizeMap,
  statusText,
  touchOf,
  touches,
} from './model'

const node = (id: string) => {
  const found = DEMO_MAP.nodes.find(one => one.id === id)
  if (found === undefined) throw new Error(`no demo node ${id}`)
  return found
}

const cart = node('src/cart.ts:renderCart')

/** An Edit result's patch: two context lines, one line replaced, at `start`. */
const patchAt = (start: number, added: string) => ({
  structuredPatch: [
    { oldStart: start, oldLines: 4, newStart: start, newLines: 4, lines: [' a', ' b', '-old', `+${added}`, ' c'] },
  ],
})

describe('paths', () => {
  test('a Windows absolute path becomes relative to the project root', () => {
    expect(relativeTo('C:\\repo\\shop', 'C:\\repo\\shop\\src\\price.ts')).toBe('src/price.ts')
    expect(relativeTo('C:/repo/shop/', 'c:/Repo/Shop/src/price.ts')).toBe('src/price.ts')
    expect(relativeTo('/repo/shop', '/elsewhere/price.ts')).toBe('/elsewhere/price.ts')
  })

  test('two spellings of one file match on a path boundary', () => {
    expect(sameFile('src/cart.ts', 'C:\\repo\\src\\cart.ts')).toBe(true)
    expect(sameFile('./src/cart.ts', 'src/Cart.ts')).toBe(true)
    expect(sameFile('src/cart.ts', 'src/old-cart.ts')).toBe(false)
    expect(sameFile('src/cart.ts', 'src/cart.tsx')).toBe(false)
    expect(sameFile('', 'src/cart.ts')).toBe(false)
  })
})

describe('patches', () => {
  test('the first changed line is read past the context lines', () => {
    const hunks = readPatch(patchAt(10, 'new'))
    expect(firstChangedLine(hunks)).toBe(12)
    expect(touchOf('src/price.ts', 'ignored', hunks)).toEqual({
      file: 'src/price.ts',
      text: 'new',
      spans: [[12, 12]],
    })
  })

  test('a result with no patch touches by its new text alone', () => {
    expect(readPatch({ ok: true })).toEqual([])
    expect(readPatch(undefined)).toEqual([])
    expect(firstChangedLine([])).toBe(undefined)
    expect(touchOf('a.ts', 'renderCart()', [])).toEqual({ file: 'a.ts', text: 'renderCart()', spans: [] })
  })
})

describe('turning callers green', () => {
  test('an edit in the same file near the node touches it', () => {
    const near = touchOf('C:/repo/src/cart.ts', '', readPatch(patchAt(20, 'x')))
    const far = touchOf('C:/repo/src/cart.ts', '', readPatch(patchAt(80, 'x')))
    expect(touches(cart, near)).toBe(true)
    expect(touches(cart, far)).toBe(false)
  })

  test('an edit that names the node touches it, as a whole word only', () => {
    expect(touches(cart, touchOf('src/cart.ts', 'export function renderCart(cart) {', []))).toBe(true)
    expect(touches(cart, touchOf('src/cart.ts', 'prerenderCartoon()', []))).toBe(false)
  })

  test('an edit in another file never does', () => {
    expect(touches(cart, touchOf('src/other.ts', 'renderCart()', readPatch(patchAt(40, 'x'))))).toBe(false)
  })

  test('only needs-review nodes turn, and the rest of the map is kept', () => {
    const touch = touchOf('src/cart.ts', '', readPatch(patchAt(12, 'formatPrice(total, cart.currency)')))
    const { map, updated } = markUpdated(DEMO_MAP, touch)
    expect(updated.map(one => one.name)).toEqual(['renderCart'])
    expect(countsOf(map).review).toBe(2)
    expect(countsOf(map).updated).toBe(1)
    expect(map.edges).toEqual(DEMO_MAP.edges)

    const again = markUpdated(map, touch)
    expect(again.updated).toEqual([])
    expect(again.map).toBe(map)
  })
})

describe('what the person reads', () => {
  test('the header counts changes, callers and reviews', () => {
    expect(headerText(DEMO_MAP)).toBe('Ripple · 1 change → 6 callers · 3 need review · via LSP · demo')
    expect(headerText({ method: 'grep', nodes: [], edges: [] })).toBe('Ripple · no function changes found')
  })

  test('the status line follows edits, mapping and reviews', () => {
    const edit: RippleEdit = { file: 'src/price.ts', snippet: 'x', at: 1 }
    const live: RippleMap = { ...DEMO_MAP, isDemo: false }
    expect(statusText([], null, false)).toBe(undefined)
    expect(statusText([edit], null, false)).toBe('ripple: 1 edit · 1 file · /ripple to map')
    expect(statusText([edit, edit, { ...edit, file: 'src/ui.ts' }], null, false)).toBe(
      'ripple: 3 edits · 2 files · /ripple to map',
    )
    expect(statusText([edit], null, true)).toBe('ripple: mapping…')
    expect(statusText([], live, false)).toBe('ripple: 3 need review · /ripple show')
    expect(statusText([edit], live, false)).toBe('ripple: 3 need review · 1 edit · 1 file · /ripple to map')
    expect(statusText([], DEMO_MAP, false)).toBe(undefined)
  })
})

describe('what Claude reads', () => {
  test('the mapping prompt lists each edit and ends on the report tool', () => {
    const prompt = mappingPrompt([
      { file: 'src/price.ts', line: 12, snippet: '\n  export function formatPrice(a, b) {\n  return 1', at: 1 },
      { file: 'README.md', snippet: '', at: 2 },
    ])
    expect(prompt.startsWith(MAPPING_MARKER)).toBe(true)
    expect(prompt).toContain('- src/price.ts:12: `export function formatPrice(a, b) {`')
    expect(prompt).toContain('- README.md\n')
    expect(prompt).toContain('prepareCallHierarchy')
    expect(prompt).toContain('Call mcp__ripple__report exactly once')
    expect(prompt).not.toContain('trace these again')
  })

  test('a re-map names the functions the last map had as changed', () => {
    const prompt = mappingPrompt([], [node('src/price.ts:formatPrice')])
    expect(prompt).toContain('- (none)')
    expect(prompt).toContain('trace these again too:\n- formatPrice (src/price.ts:1)')
  })

  test('the report result lists what needs review and what to do', () => {
    const lines = reportText(DEMO_MAP).split('\n')
    expect(lines[0]).toBe('Ripple map shown to the user: 1 changed, 6 callers, 3 need review.')
    expect(lines[1]).toBe('Needs review:')
    expect(lines[2]).toBe('- renderCart (src/cart.ts:14): passes 1 argument; formatPrice now takes 2')
    expect(lines).toHaveLength(7)
    expect(lines[5]).toBe("For each one: open it, check it against the change, and fix it if it's broken.")
  })

  test('a map with nothing to review says so', () => {
    const calm: RippleMap = {
      ...DEMO_MAP,
      nodes: DEMO_MAP.nodes.map(one => ({ ...one, status: 'ok' as const })),
    }
    expect(reportText(calm)).toContain('Nothing needs review.')
    expect(reportText({ method: 'lsp', nodes: [], edges: [] })).toContain('changed no function')
  })

  test('a Check button asks about one caller', () => {
    expect(checkPrompt(cart, DEMO_MAP)).toBe(
      'Check renderCart at src/cart.ts:14 against the change to formatPrice; fix it if needed. Ripple flagged it: passes 1 argument; formatPrice now takes 2',
    )
  })
})

describe('reading a reported map', () => {
  test('a clean map comes through whole', () => {
    const read = sanitizeMap({ method: 'lsp', nodes: DEMO_MAP.nodes, edges: DEMO_MAP.edges })
    if ('error' in read) throw new Error(read.error)
    expect(read.notes).toEqual([])
    expect(read.map.nodes).toEqual(DEMO_MAP.nodes)
    expect(read.map.edges).toEqual(DEMO_MAP.edges)
    expect(read.map.isDemo).toBe(undefined)
  })

  test('repeated ids and edges that name no node are dropped, not fatal', () => {
    const read = sanitizeMap({
      method: 'tooling',
      nodes: [
        { id: 'a', name: 'a', file: 'a.ts', line: 1, kind: 'changed', depth: 0, status: 'ok', tested: true },
        { id: 'b', name: 'b', file: 'b.ts', line: 2, kind: 'caller', depth: 1, status: 'needs-review', tested: false },
        { id: 'b', name: 'again', file: 'b.ts', line: 3, kind: 'caller', depth: 1, status: 'ok', tested: false },
      ],
      edges: [
        { from: 'b', to: 'a' },
        { from: 'b', to: 'a' },
        { from: 'b', to: 'ghost' },
        { from: 'a', to: 'a' },
        'nonsense',
      ],
    })
    if ('error' in read) throw new Error(read.error)
    expect(read.map.nodes.map(one => one.name)).toEqual(['a', 'b'])
    expect(read.map.edges).toEqual([{ from: 'b', to: 'a' }])
    expect(read.notes).toHaveLength(2)
  })

  test('loose fields are filled in', () => {
    const read = sanitizeMap({
      method: 'guesswork',
      nodes: JSON.stringify([
        { name: 'f', file: 'src\\f.ts', line: '7', depth: 0, change: 'signature' },
        { name: 'g', file: 'src/g.ts', depth: 9, status: 'needs-review', reason: '  two\n lines ' },
      ]),
    })
    if ('error' in read) throw new Error(read.error)
    expect(read.map.method).toBe('grep')
    expect(read.map.nodes).toEqual([
      { id: 'src/f.ts:f', name: 'f', file: 'src/f.ts', line: 7, kind: 'changed', depth: 0, status: 'ok', tested: false, change: 'signature' },
      { id: 'src/g.ts:g', name: 'g', file: 'src/g.ts', line: 0, kind: 'caller', depth: 2, status: 'needs-review', tested: false, reason: 'two lines' },
    ])
    expect(read.map.edges).toEqual([])
  })

  test('past the cap, changed and needs-review nodes are the ones kept', () => {
    const crowd = Array.from({ length: 60 }, (_, index) => ({
      id: `n${index}`,
      name: `n${index}`,
      file: 'x.ts',
      line: index + 1,
      kind: index === 59 ? 'changed' : 'caller',
      depth: index === 59 ? 0 : 2,
      status: index >= 50 && index < 59 ? 'needs-review' : 'ok',
      tested: true,
    }))
    const read = sanitizeMap({ method: 'grep', nodes: crowd, edges: [] })
    if ('error' in read) throw new Error(read.error)
    const kept = read.map.nodes.map(one => one.id)
    expect(kept).toHaveLength(MAX_NODES)
    expect(kept).toContain('n59')
    expect(kept).toContain('n50')
    expect(kept).toContain('n0')
    expect(kept).not.toContain('n49')
  })

  test('an empty map is a map; one that cannot be read is an error', () => {
    expect(sanitizeMap({ method: 'lsp', nodes: [], edges: [] })).toEqual({
      map: { method: 'lsp', nodes: [], edges: [] },
      notes: [],
    })
    expect('error' in sanitizeMap(undefined)).toBe(true)
    expect('error' in sanitizeMap({ method: 'lsp', nodes: 'callers' })).toBe(true)
    expect('error' in sanitizeMap({ nodes: [{ id: 'x' }] })).toBe(true)
  })
})
