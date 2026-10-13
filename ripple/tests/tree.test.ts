import { describe, expect, test } from 'claude-code/testing'

import type { RippleNode, RippleReport } from '../types'
import { SHOP_MAP } from './fixture'
import { rowText } from '../hooks/draw'
import type { Move, Pan } from '../hooks/draw'
import { filesOf } from '../hooks/files'
import { treeOf, treeView } from '../hooks/tree'

const SHOP = filesOf(SHOP_MAP)
const ORIGIN: Pan = { x: 0, y: 0 }
/** A room the shop's tree fits whole, and one four of its rows fit over the count of the rest. */
const WHOLE = { columns: 90, rows: 40 }
const SHORT = { columns: 60, rows: 5 }

const id = (name: string): string => {
  const found = SHOP_MAP.nodes.find(node => node.name === name)
  if (found === undefined) throw new Error(`no symbol ${name}`)
  return found.id
}

const node = (name: string, rest: Partial<RippleNode> = {}): RippleNode => ({
  id: name,
  name,
  kind: 'function',
  file: `${name}.ts`,
  line: 1,
  role: 'dependent',
  depth: 1,
  risk: 'ok',
  isTested: true,
  ...rest,
})

const CORE = node('core', { role: 'changed', depth: 0, change: 'behavior' })

const outline = (report: RippleReport): string[] => treeOf(filesOf(report)).map(row => `${row.lead}${row.file.path}`)

describe('the tree', () => {
  test('the files that use a file hang under it, and the files the change uses come after them', () => {
    expect(outline(SHOP_MAP)).toEqual([
      'src/price.ts',
      '├─ src/cart.ts',
      '│  └─ src/pages/checkout.ts',
      '├─ src/invoice.ts',
      '│  └─ src/pages/invoice.ts',
      '├─ src/ui.ts',
      '├─ src/email.ts',
      '└─ src/money.ts',
    ])
  })

  test('a file that uses two files of the layer nearer the change hangs under the first only', () => {
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
    expect(outline(diamond)).toEqual(['core.ts', '├─ a.ts', '│  └─ both.ts', '│     └─ deepest.ts', '└─ b.ts'])
  })

  test('each changed file heads its own tree, and a file linked to nothing is a root after them', () => {
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
    expect(outline(two)).toEqual([
      'core.ts',
      '└─ helper.ts',
      '   └─ helperOfHelper.ts',
      'other.ts',
      '└─ usesOther.ts',
      'loose.ts',
    ])
    expect(treeOf(filesOf(two)).map(row => row.parent?.path ?? null)).toEqual([
      null,
      'core.ts',
      'helper.ts',
      null,
      'other.ts',
      null,
    ])
  })

  test('files cut off from the change still hang from one another, whatever order they were reported in', () => {
    const adrift: RippleReport = {
      method: 'grep',
      nodes: [node('deeper', { depth: 2 }), CORE, node('deep')],
      edges: [{ from: 'deeper', to: 'deep' }],
    }
    expect(outline(adrift)).toEqual(['core.ts', 'deep.ts', '└─ deeper.ts'])
  })

  test('a file that uses the change and something the change uses does not carry that off from under the change', () => {
    const shared: RippleReport = {
      method: 'lsp',
      nodes: [CORE, node('user'), node('helper', { role: 'dependency' }), node('inner', { role: 'dependency', depth: 2 })],
      edges: [
        { from: 'user', to: 'core' },
        { from: 'core', to: 'helper' },
        { from: 'helper', to: 'inner' },
        { from: 'user', to: 'inner' },
      ],
    }
    expect(outline(shared)).toEqual(['core.ts', '├─ user.ts', '└─ helper.ts', '   └─ inner.ts'])
  })
})

describe('the drawing', () => {
  test('a row a file: its mark and its path, then the symbols the map has in it, in a column', () => {
    expect(treeView.draw(SHOP, id('renderInvoice'), WHOLE, ORIGIN).rows.map(rowText)).toEqual([
      '◆ src/price.ts                 formatPrice',
      '├─ ● src/cart.ts               renderCart',
      '│  └─ ○ src/pages/checkout.ts  CheckoutPage',
      '├─ ● src/invoice.ts            renderInvoice',
      '│  └─ ○ src/pages/invoice.ts   InvoicePage',
      '├─ ○ src/ui.ts                 priceLabel',
      '├─ ▲ src/email.ts              emailReceipt',
      '└─ → src/money.ts              currencySymbol, toFixed2',
    ])
  })

  test('the selected file\'s name is marked, a path is painted by its file\'s risk, and its folder and symbols are dim', () => {
    const drawing = treeView.draw(SHOP, id('renderInvoice'), WHOLE, ORIGIN)
    expect(drawing.rows[3]).toEqual([
      { text: '├─ ', paint: 'dim' },
      { text: '● ', paint: 'breaks' },
      { text: 'src/', paint: 'dim' },
      { text: 'invoice.ts', paint: 'breaks', isBold: true, isInverse: true },
      { text: '            renderInvoice', paint: 'dim' },
    ])
    expect(drawing.rows[6]?.slice(1, 4)).toEqual([
      { text: '▲ ', paint: 'review' },
      { text: 'src/', paint: 'dim' },
      { text: 'email.ts', paint: 'review' },
    ])
  })

  test('every row is a hit across the room at its own line, for the symbol selecting its file selects', () => {
    const { hits } = treeView.draw(SHOP, id('toFixed2'), { columns: 50, rows: 40 }, ORIGIN)
    expect(hits).toEqual(
      ['formatPrice', 'renderCart', 'CheckoutPage', 'renderInvoice', 'InvoicePage', 'priceLabel', 'emailReceipt', 'toFixed2'].map(
        (name, y) => ({ id: id(name), x: 0, y, width: 50, height: 1 }),
      ),
    )
  })

  test('a path too long for the room loses its start, so each file\'s own name stays, and the selected one stays marked', () => {
    const folder = 'services/billing/src/main/java/com/acme/billing/invoice'
    const deep = filesOf({
      method: 'grep',
      nodes: [
        node('Invoice', { role: 'changed', depth: 0, file: `${folder}/Invoice.java` }),
        node('InvoiceLine', { file: `${folder}/InvoiceLine.java` }),
        node('InvoiceMapper', { file: `${folder}/InvoiceMapper.java` }),
      ],
      edges: [
        { from: 'InvoiceLine', to: 'Invoice' },
        { from: 'InvoiceMapper', to: 'Invoice' },
      ],
    })
    const drawing = treeView.draw(deep, 'InvoiceMapper', { columns: 50, rows: 40 }, ORIGIN)
    expect(drawing.rows.map(rowText)).toEqual([
      '◆ …main/java/com/acme/billing/invoice/Invoice.java',
      '├─ ○ …va/com/acme/billing/invoice/InvoiceLine.java',
      '└─ ○ …/com/acme/billing/invoice/InvoiceMapper.java',
    ])
    expect(drawing.rows[2]?.find(span => span.isInverse)?.text).toBe('InvoiceMapper.java')
  })

  test('a row longer than the room ends in an ellipsis', () => {
    expect(treeView.draw(SHOP, null, { columns: 34, rows: 40 }, ORIGIN).rows.map(rowText).slice(0, 3)).toEqual([
      '◆ src/price.ts                 fo…',
      '├─ ● src/cart.ts               re…',
      '│  └─ ○ src/pages/checkout.ts  Ch…',
    ])
  })
})

describe('a room too short for every row', () => {
  test('the window shows the rows from where it stands, over a row that counts the files above and below', () => {
    const drawing = treeView.draw(SHOP, id('priceLabel'), SHORT, { x: 0, y: 2 })
    expect(drawing.rows.map(rowText)).toEqual([
      '│  └─ ○ src/pages/checkout.ts  CheckoutPage',
      '├─ ● src/invoice.ts            renderInvoice',
      '│  └─ ○ src/pages/invoice.ts   InvoicePage',
      '├─ ○ src/ui.ts                 priceLabel',
      '                    ↑ 2 more · ↓ 2 more',
    ])
    expect(drawing.hits.slice(4)).toEqual([
      { x: 20, y: 4, width: 8, height: 1, by: { x: 0, y: -4 } },
      { x: 31, y: 4, width: 8, height: 1, by: { x: 0, y: 4 } },
    ])
  })

  test('at either end only the other side is counted, and the window goes no farther', () => {
    const rowsAt = (y: number): string[] => treeView.draw(SHOP, null, SHORT, { x: 0, y }).rows.map(rowText)
    expect([rowsAt(0)[0], rowsAt(0).at(-1)?.trim()]).toEqual(['◆ src/price.ts                 formatPrice', '↓ 4 more'])
    expect([rowsAt(9)[3], rowsAt(9).at(-1)?.trim()]).toEqual([
      '└─ → src/money.ts              currencySymbol, toFixed2',
      '↑ 4 more',
    ])
    expect(rowsAt(-3)).toEqual(rowsAt(0))
  })

  test('the window moves no farther than it must to show the selected row and the one past it', () => {
    const shownFor = (name: string, from: number): number => treeView.show(SHOP, id(name), SHORT, { x: 0, y: from }).y
    expect(shownFor('formatPrice', 0)).toBe(0)
    expect(shownFor('CheckoutPage', 0)).toBe(0)
    expect(shownFor('priceLabel', 0)).toBe(3)
    expect(shownFor('toFixed2', 0)).toBe(4)
    expect(shownFor('renderInvoice', 4)).toBe(2)
    expect(shownFor('formatPrice', 4)).toBe(0)
  })

  test('the wheel scrolls two rows a turn, a click on a count a room, and neither past the ends', () => {
    expect(treeView.scroll(SHOP, SHORT, ORIGIN, 1)).toEqual({ x: 0, y: 2 })
    expect(treeView.scroll(SHOP, SHORT, ORIGIN, 9)).toEqual({ x: 0, y: 4 })
    expect(treeView.scroll(SHOP, SHORT, { x: 0, y: 3 }, { x: 0, y: -4 })).toEqual(ORIGIN)
    expect(treeView.scroll(SHOP, WHOLE, ORIGIN, 3)).toEqual(ORIGIN)
  })
})

describe('moving the selection', () => {
  const walk = (from: string, ...moves: Move[]): string =>
    SHOP_MAP.nodes.find(
      one => one.id === moves.reduce<string | null>((at, move) => treeView.step(SHOP, at, move, WHOLE, ORIGIN), id(from)),
    )?.file ?? ''

  test('up and down walk the rows, into and out of subtrees, and stop at the ends', () => {
    expect(walk('renderCart', 'down')).toBe('src/pages/checkout.ts')
    expect(walk('renderCart', 'down', 'down')).toBe('src/invoice.ts')
    expect(walk('formatPrice', 'up')).toBe('src/price.ts')
    expect(walk('toFixed2', 'down')).toBe('src/money.ts')
  })

  test('left goes to the file a row hangs under and right to the first that hangs under it', () => {
    expect(walk('InvoicePage', 'left')).toBe('src/invoice.ts')
    expect(walk('InvoicePage', 'left', 'left')).toBe('src/price.ts')
    expect(walk('formatPrice', 'left')).toBe('src/price.ts')
    expect(walk('formatPrice', 'right')).toBe('src/cart.ts')
    expect(walk('renderInvoice', 'right')).toBe('src/pages/invoice.ts')
    expect(walk('priceLabel', 'right')).toBe('src/ui.ts')
  })

  test('a move lands on the first symbol of the file it reaches, and one that goes nowhere keeps the symbol selected', () => {
    expect(treeView.step(SHOP, id('emailReceipt'), 'down', WHOLE, ORIGIN)).toBe(id('currencySymbol'))
    expect(treeView.step(SHOP, id('toFixed2'), 'down', WHOLE, ORIGIN)).toBe(id('toFixed2'))
  })
})
