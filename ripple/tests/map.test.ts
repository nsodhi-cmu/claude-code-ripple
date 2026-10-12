import { describe, expect, test } from 'claude-code/testing'

import type { RippleReport } from '../types'
import { SHOP_MAP, SHOP_REPORT } from './fixture'
import {
  MAX_NODES,
  flagged,
  headerText,
  neighborsOf,
  originText,
  rankOf,
  readReport,
  readStored,
  statusText,
} from '../hooks/map'

const read = (input: unknown): { report: RippleReport; notes: string[] } => {
  const result = readReport(input)
  if ('error' in result) throw new Error(result.error)
  return result
}

const depths = (report: RippleReport): Record<string, number> =>
  Object.fromEntries(report.nodes.map(node => [node.name, node.depth]))

/** A reported node with only what a test cares about. */
const reported = (name: string, rest: Record<string, unknown> = {}) => ({
  id: name,
  name,
  kind: 'function',
  file: `src/${name}.ts`,
  line: 1,
  role: 'dependent',
  risk: 'ok',
  isTested: true,
  ...rest,
})

const CORE = reported('core', { role: 'changed', change: 'behavior' })

describe('reading a report', () => {
  test('a clean report comes through whole, each depth worked out from the edges', () => {
    const { report, notes } = read(SHOP_REPORT)
    expect(notes).toEqual([])
    expect(report.nodes).toEqual(SHOP_MAP.nodes)
    expect(report.edges).toEqual(SHOP_MAP.edges)
    expect(report.summary).toBe(SHOP_MAP.summary)
  })

  test('an edge reported backward is turned to run from the user to the used', () => {
    const backward = SHOP_REPORT.edges.map(edge => ({ from: edge.to, to: edge.from }))
    const { report } = read({ ...SHOP_REPORT, edges: backward })
    expect(report.edges).toEqual(SHOP_MAP.edges)
    expect(depths(report)).toEqual(depths(SHOP_MAP))
  })

  test('the same use reported in both directions is one edge', () => {
    const { report } = read({
      method: 'grep',
      nodes: [CORE, reported('a')],
      edges: [
        { from: 'a', to: 'core' },
        { from: 'core', to: 'a' },
      ],
    })
    expect(report.edges).toEqual([{ from: 'a', to: 'core' }])
  })

  test('depth is the shortest way to a changed symbol, on either side of it', () => {
    const { report } = read({
      method: 'lsp',
      nodes: [
        CORE,
        reported('a'),
        reported('b'),
        reported('c'),
        reported('shortcut'),
        reported('x', { role: 'dependency' }),
        reported('y', { role: 'dependency' }),
      ],
      edges: [
        { from: 'a', to: 'core' },
        { from: 'b', to: 'a' },
        { from: 'c', to: 'b' },
        { from: 'shortcut', to: 'c' },
        { from: 'shortcut', to: 'core' },
        { from: 'core', to: 'x' },
        { from: 'x', to: 'y' },
      ],
    })
    expect(depths(report)).toEqual({ core: 0, a: 1, b: 2, c: 3, shortcut: 1, x: 1, y: 2 })
    expect(report.nodes.map(rankOf)).toEqual([0, -1, -2, -3, -1, 1, 2])
  })

  test('a dependent no edge reaches sits one step out, and a dependency is never counted as a way to one', () => {
    const { report } = read({
      method: 'grep',
      nodes: [CORE, reported('loose'), reported('helper', { role: 'dependency' }), reported('viaHelper')],
      edges: [
        { from: 'core', to: 'helper' },
        { from: 'viaHelper', to: 'helper' },
      ],
    })
    expect(depths(report)).toEqual({ core: 0, loose: 1, helper: 1, viaHelper: 1 })
  })

  test('a node says its role or is given one: changed when it carries a change, else a dependent', () => {
    const { report } = read({
      method: 'lsp',
      nodes: [
        { name: 'renamed', file: 'a.rs', kind: 'Struct', change: 'renamed', risk: 'breaks' },
        { name: 'user', file: 'b.rs', risk: 'breaks', reason: '  still   names\nthe old struct ' },
        { name: 'helper', file: 'c.rs', role: 'dependency', risk: 'breaks', change: 'added' },
      ],
      edges: [],
    })
    expect(report.nodes).toEqual([
      {
        id: 'a.rs:renamed',
        name: 'renamed',
        kind: 'struct',
        file: 'a.rs',
        line: 0,
        role: 'changed',
        depth: 0,
        change: 'renamed',
        risk: 'ok',
        isTested: false,
      },
      {
        id: 'b.rs:user',
        name: 'user',
        kind: 'symbol',
        file: 'b.rs',
        line: 0,
        role: 'dependent',
        depth: 1,
        risk: 'breaks',
        isTested: false,
        reason: 'still names the old struct',
      },
      {
        id: 'c.rs:helper',
        name: 'helper',
        kind: 'symbol',
        file: 'c.rs',
        line: 0,
        role: 'dependency',
        depth: 1,
        risk: 'ok',
        isTested: false,
      },
    ])
  })

  test('repeated ids, nameless nodes, and edges that name no node are dropped, and each repair is noted', () => {
    const { report, notes } = read({
      method: 'tooling',
      nodes: [CORE, reported('a'), reported('a'), { file: 'src/nameless.ts' }],
      edges: [
        { from: 'a', to: 'core' },
        { from: 'ghost', to: 'core' },
        { from: 'a', to: 'a' },
        'not an edge',
      ],
    })
    expect(report.nodes.map(node => node.id)).toEqual(['core', 'a'])
    expect(report.edges).toEqual([{ from: 'a', to: 'core' }])
    expect(notes).toEqual([
      'dropped 2 nodes with a repeated id or no name',
      'dropped 3 edges that named no node',
    ])
  })

  test('past the cap the changed and the flagged are kept, and the edges of what is cut go with it', () => {
    const fillers = Array.from({ length: MAX_NODES + 5 }, (_, index) => reported(`filler${index}`))
    const late = [
      reported('lateBreak', { risk: 'breaks', reason: 'gone' }),
      reported('lateReview', { risk: 'review', reason: 'differs' }),
    ]
    const nodes = [...fillers, ...late, CORE]
    const edges = nodes.filter(node => node !== CORE).map(node => ({ from: node.id, to: 'core' }))
    const { report, notes } = read({ method: 'grep', nodes, edges })

    expect(report.nodes).toHaveLength(MAX_NODES)
    const kept = new Set(report.nodes.map(node => node.id))
    expect(['core', 'lateBreak', 'lateReview'].every(id => kept.has(id))).toBe(true)
    expect(kept.has('filler0')).toBe(true)
    expect(kept.has(`filler${MAX_NODES + 4}`)).toBe(false)
    expect(report.edges).toHaveLength(MAX_NODES - 1)
    expect(report.edges.every(edge => kept.has(edge.from) && kept.has(edge.to))).toBe(true)
    expect(notes).toEqual([`kept ${MAX_NODES} of ${MAX_NODES + 8} nodes`])
  })

  test('a reason or a summary too long to draw is cut, and ends on an ellipsis to say so', () => {
    const long = 'word '.repeat(100).trim()
    const { report } = read({
      method: 'lsp',
      summary: long,
      nodes: [CORE, reported('a', { risk: 'review', reason: long })],
      edges: [],
    })
    const reason = report.nodes[1]?.reason ?? ''
    expect(reason).toHaveLength(200)
    expect(reason).toEndWith('word word…')
    expect(report.summary).toHaveLength(240)
    expect(report.summary).toEndWith('…')
    expect(read({ method: 'lsp', summary: 'Nothing breaks.', nodes: [], edges: [] }).report.summary).toBe('Nothing breaks.')
  })

  test('nodes and edges sent as JSON text are read as the arrays they spell', () => {
    const { report } = read({
      method: 'lsp',
      nodes: JSON.stringify([CORE, reported('a')]),
      edges: JSON.stringify([{ from: 'a', to: 'core' }]),
    })
    expect(depths(report)).toEqual({ core: 0, a: 1 })
    expect(report.edges).toHaveLength(1)
  })

  test('only a report that cannot be read at all is an error', () => {
    expect(readReport('a map')).toEqual({ error: 'the input is not an object.' })
    expect(readReport({ method: 'lsp', nodes: 'everything', edges: [] })).toEqual({
      error: '`nodes` must be an array.',
    })
    expect(readReport({ nodes: [{ line: 3 }], edges: [] })).toEqual({
      error: 'no node had both a `name` and a `file`.',
    })
    expect(read({ nodes: [], edges: [] }).report).toEqual({ method: 'grep', nodes: [], edges: [] })
  })
})

describe('what the person reads', () => {
  test('the header counts the changes, what they reach, and what is at risk', () => {
    expect(headerText(SHOP_MAP)).toBe('Ripple · 1 change → 6 dependents · 2 break · 1 to review')
    const calm = { ...SHOP_MAP, nodes: SHOP_MAP.nodes.map(node => ({ ...node, risk: 'ok' as const })) }
    expect(headerText(calm)).toBe('Ripple · 1 change → 6 dependents · nothing flagged')
    const one = read({
      method: 'lsp',
      nodes: [CORE, reported('a', { risk: 'breaks' })],
      edges: [{ from: 'a', to: 'core' }],
    })
    expect(headerText(one.report)).toBe('Ripple · 1 change → 1 dependent · 1 breaks')
    expect(headerText({ method: 'grep', nodes: [], edges: [] })).toBe(
      'Ripple · the changes touch no symbol other code uses',
    )
  })

  test('the line under it says which changes, how they were traced, and the focus if there was one', () => {
    expect(originText(SHOP_MAP)).toBe('uncommitted changes · via LSP')
    expect(originText({ ...SHOP_MAP, scope: 'branch', base: 'main', method: 'grep', focus: 'formatPrice' })).toBe(
      'branch since main · via text search · focus: formatPrice',
    )
  })

  test('the status line speaks only while mapping or while something is flagged', () => {
    expect(statusText(null, false)).toBe(undefined)
    expect(statusText(SHOP_MAP, true)).toBe('mapping…')
    expect(statusText(SHOP_MAP, false)).toBe('2 break · 1 to review · /ripple')
    const calm = { ...SHOP_MAP, nodes: SHOP_MAP.nodes.map(node => ({ ...node, risk: 'ok' as const })) }
    expect(statusText(calm, false)).toBe(undefined)
  })

  test('what breaks is listed before what needs review, whatever order they were reported in', () => {
    const reordered = { ...SHOP_MAP, nodes: [...SHOP_MAP.nodes].reverse() }
    expect(flagged(reordered).map(node => node.name)).toEqual(['renderInvoice', 'renderCart', 'emailReceipt'])
  })

  test('a node knows what it uses and what uses it', () => {
    const names = (id: string) => {
      const { uses, usedBy } = neighborsOf(SHOP_MAP, id)
      return { uses: uses.map(node => node.name), usedBy: usedBy.map(node => node.name) }
    }
    expect(names('src/cart.ts:renderCart')).toEqual({ uses: ['formatPrice'], usedBy: ['CheckoutPage'] })
    expect(names('src/price.ts:formatPrice')).toEqual({
      uses: ['toFixed2', 'currencySymbol'],
      usedBy: ['renderCart', 'renderInvoice', 'priceLabel', 'emailReceipt'],
    })
  })
})

describe('the map the store kept', () => {
  test('a stored map reads back as it was', () => {
    const stored = { ...SHOP_MAP, scope: 'branch', base: 'main', focus: 'formatPrice', print: '12:ab' }
    expect(readStored(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
  })

  test('what does not say which changes it is of is not a map', () => {
    expect(readStored(SHOP_REPORT)).toBe(null)
    expect(readStored({ ...SHOP_MAP, scope: 'everything' })).toBe(null)
    expect(readStored(undefined)).toBe(null)
  })
})
