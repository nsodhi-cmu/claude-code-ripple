import { describe, expect, test } from 'claude-code/testing'

import type { RippleEdit, RippleMap } from '../types'
import { SHOP_MAP } from './fixture'
import {
  MAPPING_MARKER,
  MAX_NODES,
  checkPrompt,
  countsOf,
  fileCount,
  headerText,
  hunkKey,
  mappingPrompt,
  markUpdated,
  newFileHunks,
  parseDiff,
  printOf,
  readStored,
  reportText,
  sameFile,
  sanitizeMap,
  statusText,
  touchOf,
  touches,
} from '../hooks/model'

const node = (id: string) => {
  const found = SHOP_MAP.nodes.find(one => one.id === id)
  if (found === undefined) throw new Error(`no node ${id}`)
  return found
}

/** renderCart, flagged, calling formatPrice at src/cart.ts:14. */
const cart = node('src/cart.ts:renderCart')

/** One hunk of a diff: `snippet` added at `line` of `file`. */
const hunk = (file: string, line: number, snippet: string): RippleEdit => ({ file, line, snippet, at: 1 })


describe('paths', () => {
  test('two spellings of one file match on a path boundary', () => {
    expect(sameFile('src/cart.ts', 'C:\\repo\\src\\cart.ts')).toBe(true)
    expect(sameFile('./src/cart.ts', 'src/Cart.ts')).toBe(true)
    expect(sameFile('src/cart.ts', 'src/old-cart.ts')).toBe(false)
    expect(sameFile('src/cart.ts', 'src/cart.tsx')).toBe(false)
    expect(sameFile('', 'src/cart.ts')).toBe(false)
  })
})

describe('reading a git diff', () => {
  const diff = [
    'diff --git a/src/price.ts b/src/price.ts',
    'index 1111111..2222222 100644',
    '--- a/src/price.ts',
    '+++ b/src/price.ts',
    '@@ -1 +1 @@',
    '-export function formatPrice(amount: number): string {',
    '+export function formatPrice(amount: number, currency: string): string {',
    '@@ -9,0 +10,2 @@ export function currencySymbol(): string {',
    '+++ not a header: an added line that starts with two pluses',
    '+second',
    'diff --git a/src/old.ts b/src/old.ts',
    'deleted file mode 100644',
    '--- a/src/old.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-gone',
    '-gone too',
    '',
  ].join('\r\n')

  test('each hunk is one entry: the file, the first new line, the added text', () => {
    expect(parseDiff(diff, 7)).toEqual([
      { file: 'src/price.ts', line: 1, snippet: 'export function formatPrice(amount: number, currency: string): string {', at: 7 },
      { file: 'src/price.ts', line: 10, snippet: '++ not a header: an added line that starts with two pluses\nsecond', at: 7 },
      { file: 'src/old.ts', line: 1, snippet: '', at: 7 },
    ])
    expect(parseDiff('', 7)).toEqual([])
    expect(fileCount(parseDiff(diff, 7))).toBe(2)
  })

  test('a file git does not track yet is a change too', () => {
    expect(newFileHunks('src/new.ts\n"src/with space.ts"\n.ripple/graph.html\n\n', 3)).toEqual([
      { file: 'src/new.ts', line: 1, snippet: '(new file, not yet tracked by git)', at: 3 },
      { file: 'src/with space.ts', line: 1, snippet: '(new file, not yet tracked by git)', at: 3 },
    ])
    expect(newFileHunks('', 3)).toEqual([])
  })

  test('the same diff has the same print, a different one another', () => {
    expect(printOf(diff)).toBe(printOf(diff))
    expect(printOf(diff)).not.toBe(printOf(diff.replace('currency', 'coinage')))
    expect(printOf('')).toBe('0:1505')
  })

  test('a hunk is named by its file and text, wherever it now sits', () => {
    expect(hunkKey(hunk('src/a.ts', 3, 'x = 1'))).toBe(hunkKey(hunk('src/a.ts', 90, 'x = 1')))
    expect(hunkKey(hunk('src/a.ts', 3, 'x = 1'))).not.toBe(hunkKey(hunk('src/a.ts', 3, 'x = 2')))
    expect(hunkKey(hunk('src/a.ts', 3, 'x = 1'))).not.toBe(hunkKey(hunk('src/b.ts', 3, 'x = 1')))
  })
})

describe('turning callers green', () => {
  test('a hunk covers the lines of its added text', () => {
    expect(touchOf(hunk('a.ts', 10, 'one\ntwo\nthree'))).toEqual({ file: 'a.ts', text: 'one\ntwo\nthree', spans: [[10, 12]] })
    expect(touchOf(hunk('a.ts', 10, ''))).toEqual({ file: 'a.ts', text: '', spans: [[10, 10]] })
  })

  test('a hunk in the same file near the node touches it', () => {
    expect(touches(cart, touchOf(hunk('src/cart.ts', 22, 'x')))).toBe(true)
    expect(touches(cart, touchOf(hunk('src/cart.ts', 80, 'x')))).toBe(false)
  })

  test('a hunk that names the node touches it, as a whole word only', () => {
    expect(touches(cart, touchOf(hunk('src/cart.ts', 200, 'export function renderCart(cart) {')))).toBe(true)
    expect(touches(cart, touchOf(hunk('src/cart.ts', 200, 'prerenderCartoon()')))).toBe(false)
  })

  test('a hunk in another file never does', () => {
    expect(touches(cart, touchOf(hunk('src/other.ts', 14, 'renderCart()')))).toBe(false)
  })

  test('only needs-review nodes turn, and the rest of the map is kept', () => {
    const touch = touchOf(hunk('src/cart.ts', 14, 'formatPrice(total, cart.currency)'))
    const { map, updated } = markUpdated(SHOP_MAP, touch)
    expect(updated.map(one => one.name)).toEqual(['renderCart'])
    expect(countsOf(map).review).toBe(2)
    expect(countsOf(map).updated).toBe(1)
    expect(map.edges).toEqual(SHOP_MAP.edges)

    const again = markUpdated(map, touch)
    expect(again.updated).toEqual([])
    expect(again.map).toBe(map)
  })
})

describe('what the person reads', () => {
  test('the header counts changes, callers and reviews', () => {
    expect(headerText(SHOP_MAP)).toBe('Ripple · 1 change → 6 callers · 3 need review · via LSP')
    expect(headerText({ method: 'grep', nodes: [], edges: [] })).toBe('Ripple · no function changes found')
  })

  test('the status line follows the uncommitted changes, mapping and reviews', () => {
    expect(statusText(null, false, 0)).toBe(undefined)
    expect(statusText(null, false, 72)).toBe('ripple: uncommitted changes in 72 files · /ripple to map')
    expect(statusText(null, false, 1)).toBe('ripple: uncommitted changes in 1 file · /ripple to map')
    expect(statusText(null, true, 72)).toBe('ripple: mapping…')
    expect(statusText(SHOP_MAP, false, 0)).toBe('ripple: 3 need review · /ripple to see the map')
    expect(statusText(SHOP_MAP, false, 2)).toBe('ripple: 3 need review · uncommitted changes in 2 files · /ripple to map')
  })
})

describe('what Claude reads', () => {
  test('the mapping prompt lists each hunk of the diff and ends on the report tool', () => {
    const prompt = mappingPrompt([
      hunk('src/price.ts', 1, '\n  export function formatPrice(a, b) {\n  return 1'),
      hunk('src/old.ts', 1, ''),
      hunk('src/new.ts', 1, '(new file, not yet tracked by git)'),
    ])
    expect(prompt.startsWith(MAPPING_MARKER)).toBe(true)
    expect(prompt).toContain('Uncommitted changes in the working tree (from `git diff HEAD`')
    expect(prompt).toContain('- src/price.ts:1: `export function formatPrice(a, b) {`')
    expect(prompt).toContain('- src/old.ts:1\n')
    expect(prompt).toContain('- src/new.ts:1: `(new file, not yet tracked by git)`')
    expect(prompt).toContain('prepareCallHierarchy')
    expect(prompt).toContain('Call mcp__ripple__report exactly once')
  })

  test('a large diff is listed one line a file', () => {
    const many = Array.from({ length: 90 }, (_, index) =>
      hunk(`src/games/g${index % 45}.rs`, 10 + index, `fn drawGame${index}()`),
    )
    const prompt = mappingPrompt(many)
    expect(prompt).toContain('- src/games/g0.rs (2 changes, first at line 10): `fn drawGame0()`')
    expect(prompt).not.toContain('g0.rs:10')
    const crowd = Array.from({ length: 70 }, (_, index) => hunk(`f${index}.rs`, 1, 'x'))
    expect(mappingPrompt(crowd)).toContain('- and 10 more files')
  })

  test('the report result lists what needs review and what to do', () => {
    const lines = reportText(SHOP_MAP).split('\n')
    expect(lines[0]).toBe('Ripple map shown to the user: 1 changed, 6 callers, 3 need review.')
    expect(lines[1]).toBe('Needs review:')
    expect(lines[2]).toBe('- renderCart (src/cart.ts:14): passes 1 argument; formatPrice now takes 2')
    expect(lines).toHaveLength(7)
    expect(lines[5]).toBe("For each one: open it, check it against the change, and fix it if it's broken.")
  })

  test('a map with nothing to review says so', () => {
    const calm: RippleMap = {
      ...SHOP_MAP,
      nodes: SHOP_MAP.nodes.map(one => ({ ...one, status: 'ok' as const })),
    }
    expect(reportText(calm)).toContain('Nothing needs review.')
    expect(reportText({ method: 'lsp', nodes: [], edges: [] })).toContain('touched no function')
  })

  test('a Check button asks about one caller', () => {
    expect(checkPrompt(cart, SHOP_MAP)).toBe(
      'Check renderCart at src/cart.ts:14 against the change to formatPrice; fix it if needed. Ripple flagged it: passes 1 argument; formatPrice now takes 2',
    )
  })
})

describe('reading a reported map', () => {
  test('a clean map comes through whole', () => {
    const read = sanitizeMap(SHOP_MAP)
    if ('error' in read) throw new Error(read.error)
    expect(read.notes).toEqual([])
    expect(read.map.nodes).toEqual(SHOP_MAP.nodes)
    expect(read.map.edges).toEqual(SHOP_MAP.edges)
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

  test('a kept map comes back with the print of the diff it was made from', () => {
    expect(readStored({ ...SHOP_MAP, print: '12:ab' })).toEqual({ ...SHOP_MAP, print: '12:ab' })
    expect(readStored(SHOP_MAP)).toEqual(SHOP_MAP)
    expect(readStored(undefined)).toBe(null)
    expect(readStored({ method: 'lsp', nodes: [], edges: [] })).toBe(null)
  })
})
