import { describe, expect, test } from 'claude-code/testing'

import type { RippleNode, RippleReport } from '../types'
import { SHOP_MAP } from './fixture'
import { rowText } from '../hooks/draw'
import { drawTree, stepInTree, treeOf } from '../hooks/tree'

const id = (name: string): string => {
  const found = SHOP_MAP.nodes.find(node => node.name === name)
  if (found === undefined) throw new Error(`no node ${name}`)
  return found.id
}

const node = (name: string, rest: Partial<RippleNode> = {}): RippleNode => ({
  id: name,
  name,
  kind: 'function',
  file: `src/${name}.ts`,
  line: 1,
  role: 'dependent',
  depth: 1,
  risk: 'ok',
  isTested: true,
  ...rest,
})

const CORE = node('core', { role: 'changed', depth: 0, change: 'behavior' })

const outline = (report: RippleReport): string[] => treeOf(report).map(row => `${row.lead}${row.node.name}`)

describe('the tree', () => {
  test('dependents hang under what they use, and what the change uses comes after them', () => {
    expect(outline(SHOP_MAP)).toEqual([
      'formatPrice',
      '├─ renderCart',
      '│  └─ CheckoutPage',
      '├─ renderInvoice',
      '│  └─ InvoicePage',
      '├─ priceLabel',
      '├─ emailReceipt',
      '├─ toFixed2',
      '└─ currencySymbol',
    ])
  })

  test('a node that uses two nodes of the layer nearer the change hangs under the first only', () => {
    const diamond: RippleReport = {
      method: 'lsp',
      nodes: [CORE, node('a'), node('b'), node('both', { depth: 2 }), node('deepest', { depth: 3 })],
      edges: [
        { from: 'a', to: 'core' },
        { from: 'b', to: 'core' },
        { from: 'both', to: 'b' },
        { from: 'both', to: 'a' },
        { from: 'deepest', to: 'both' },
      ],
    }
    expect(outline(diamond)).toEqual(['core', '├─ a', '│  └─ both', '│     └─ deepest', '└─ b'])
  })

  test('each changed symbol heads its own tree, and a node linked to nothing is a root after them', () => {
    const two: RippleReport = {
      method: 'grep',
      nodes: [
        node('loose'),
        CORE,
        node('other', { role: 'changed', depth: 0, change: 'renamed' }),
        node('usesOther'),
        node('helper', { role: 'dependency' }),
        node('helperOfHelper', { role: 'dependency', depth: 2 }),
      ],
      edges: [
        { from: 'usesOther', to: 'other' },
        { from: 'core', to: 'helper' },
        { from: 'helper', to: 'helperOfHelper' },
      ],
    }
    expect(outline(two)).toEqual(['core', '└─ helper', '   └─ helperOfHelper', 'other', '└─ usesOther', 'loose'])
    expect(treeOf(two).map(row => row.parent)).toEqual([null, 'core', 'helper', null, 'other', null])
  })
})

describe('the drawing', () => {
  test('one row a node: its mark and name, where it is, and what to know of it, in columns', () => {
    expect(drawTree(SHOP_MAP, id('renderInvoice'), { columns: 90, rows: 40 }).rows.map(rowText)).toEqual([
      '◆ formatPrice         src/price.ts:1           signature changed',
      '├─ ● renderCart       src/cart.ts:14           breaks · untested',
      '│  └─ ○ CheckoutPage  src/pages/checkout.ts:5',
      '├─ ● renderInvoice    src/invoice.ts:11        breaks',
      '│  └─ ○ InvoicePage   src/pages/invoice.ts:5',
      '├─ ○ priceLabel       src/ui.ts:4',
      '├─ ▲ emailReceipt     src/email.ts:6           review',
      '├─ → toFixed2         src/price.ts:9',
      '└─ → currencySymbol   src/price.ts:13',
    ])
  })

  test('the selected row is marked, each row is painted by its risk, and a dependency is never called untested', () => {
    const drawing = drawTree(SHOP_MAP, id('renderInvoice'), { columns: 90, rows: 40 })
    expect(drawing.rows[3]).toEqual([
      { text: '├─ ', paint: 'dim' },
      { text: '● renderInvoice', paint: 'breaks', isBold: true, isInverse: true },
      { text: '    src/invoice.ts:11', paint: 'dim' },
      { text: '        breaks', paint: 'breaks' },
    ])
    expect(drawing.rows[6]?.at(-1)).toEqual({ text: '           review', paint: 'review' })
    const untestedHelper = {
      ...SHOP_MAP,
      nodes: SHOP_MAP.nodes.map(one => (one.role === 'dependency' ? { ...one, isTested: false } : one)),
    }
    expect(rowText(drawTree(untestedHelper, null, { columns: 90, rows: 40 }).rows[7] ?? [])).toBe(
      '├─ → toFixed2         src/price.ts:9',
    )
  })

  test('every row is a hit across the room at its own line', () => {
    const { hits } = drawTree(SHOP_MAP, null, { columns: 50, rows: 40 })
    expect(hits.map(hit => [hit.id, hit.y, hit.width, hit.height])).toEqual(
      treeOf(SHOP_MAP).map((row, index) => [row.node.id, index, 50, 1]),
    )
  })

  test('a room too short keeps the rows around the selection, counts what it cut, and lets a click reach it', () => {
    const drawing = drawTree(SHOP_MAP, id('priceLabel'), { columns: 90, rows: 6 })
    const rows = drawing.rows.map(rowText)
    expect(rows).toHaveLength(6)
    expect(rows[0]).toBe('↑ 3 more above')
    expect(rows.at(-1)).toBe('↓ 2 more below')
    expect(rows.join('\n')).toContain('○ priceLabel')
    expect(drawing.hits.map(hit => [hit.id, hit.y])).toEqual([
      [id('CheckoutPage'), 0],
      [id('renderInvoice'), 1],
      [id('InvoicePage'), 2],
      [id('priceLabel'), 3],
      [id('emailReceipt'), 4],
      [id('toFixed2'), 5],
    ])
  })

  test('at the top of a cut tree nothing is said to be above', () => {
    const rows = drawTree(SHOP_MAP, id('formatPrice'), { columns: 90, rows: 6 }).rows.map(rowText)
    expect(rows[0]).toBe('')
    expect(rows[1]).toStartWith('◆ formatPrice')
    expect(rows.at(-1)).toBe('↓ 5 more below')
  })
})

describe('moving the selection', () => {
  const step = (from: string, ...moves: Array<'left' | 'right' | 'up' | 'down'>): string =>
    SHOP_MAP.nodes.find(one => one.id === moves.reduce((at, move) => stepInTree(SHOP_MAP, at, move), id(from)))
      ?.name ?? ''

  test('up and down walk the rows, into and out of subtrees, and stop at the ends', () => {
    expect(step('renderCart', 'down')).toBe('CheckoutPage')
    expect(step('renderCart', 'down', 'down')).toBe('renderInvoice')
    expect(step('formatPrice', 'up')).toBe('formatPrice')
    expect(step('currencySymbol', 'down')).toBe('currencySymbol')
  })

  test('left goes to the node a row hangs under and right to the first that hangs under it', () => {
    expect(step('InvoicePage', 'left')).toBe('renderInvoice')
    expect(step('InvoicePage', 'left', 'left')).toBe('formatPrice')
    expect(step('formatPrice', 'left')).toBe('formatPrice')
    expect(step('formatPrice', 'right')).toBe('renderCart')
    expect(step('renderInvoice', 'right')).toBe('InvoicePage')
    expect(step('priceLabel', 'right')).toBe('priceLabel')
  })
})
