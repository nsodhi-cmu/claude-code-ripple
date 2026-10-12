import { describe, expect, test } from 'claude-code/testing'

import type { RippleMap } from '../types'
import { SHOP_MAP } from './fixture'
import { rowText } from '../hooks/draw'
import { GRAPH_COLUMNS, GRAPH_ROWS } from '../hooks/graph'
import {
  detailOf,
  drawView,
  flowRows,
  modeIn,
  nextFlagged,
  planOf,
  selectedOf,
  stepped,
  wrappedRows,
} from '../hooks/view'

const id = (name: string): string => node(name).id

const node = (name: string) => {
  const found = SHOP_MAP.nodes.find(one => one.name === name)
  if (found === undefined) throw new Error(`no node ${name}`)
  return found
}

const calm: RippleMap = { ...SHOP_MAP, nodes: SHOP_MAP.nodes.map(one => ({ ...one, risk: 'ok' as const })) }

describe('the selected node', () => {
  test('it is the one the view names, while the map still holds it', () => {
    expect(selectedOf(SHOP_MAP, id('priceLabel'))?.name).toBe('priceLabel')
  })

  test('a reader starts on what breaks, else on what changed, else on anything', () => {
    expect(selectedOf(SHOP_MAP, null)?.name).toBe('renderCart')
    expect(selectedOf(SHOP_MAP, 'src/gone.ts:removed')?.name).toBe('renderCart')
    expect(selectedOf(calm, null)?.name).toBe('formatPrice')
    const noChange = { ...calm, nodes: calm.nodes.filter(one => one.role !== 'changed') }
    expect(selectedOf(noChange, null)?.name).toBe('renderCart')
    expect(selectedOf({ ...calm, nodes: [], edges: [] }, null)).toBeUndefined()
  })
})

describe('stepping', () => {
  test('the same key means the view\'s own direction: down a layer in the graph, down a row in the tree', () => {
    expect(stepped(SHOP_MAP, 'graph', id('formatPrice'), 'down')).toBe(id('toFixed2'))
    expect(stepped(SHOP_MAP, 'tree', id('formatPrice'), 'down')).toBe(id('renderCart'))
  })

  test('a step with nothing selected yet is taken from where a reader starts', () => {
    expect(stepped(SHOP_MAP, 'graph', null, 'right')).toBe(id('renderInvoice'))
  })

  test('next flagged goes through what breaks, then what needs review, and round again', () => {
    const tour = [id('formatPrice')]
    for (let step = 0; step < 4; step += 1) tour.push(nextFlagged(SHOP_MAP, tour.at(-1) ?? null) ?? '')
    expect(tour.slice(1)).toEqual([id('renderCart'), id('renderInvoice'), id('emailReceipt'), id('renderCart')])
  })

  test('with nothing flagged the selection stays where it is', () => {
    expect(nextFlagged(calm, id('priceLabel'))).toBe(id('priceLabel'))
  })
})

describe('drawing the view', () => {
  const firstRow = (mode: 'graph' | 'tree', columns: number): string =>
    rowText(drawView(SHOP_MAP, mode, null, { columns, rows: 40 }).rows[0] ?? [])

  test('each mode draws its own picture', () => {
    expect(firstRow('graph', 90)).toContain('┌────────────────┐')
    expect(firstRow('tree', 90)).toStartWith('◆ formatPrice')
  })

  test('a room too narrow or too short for the graph gets the tree instead', () => {
    expect(firstRow('graph', GRAPH_COLUMNS)).toContain('┌')
    expect(firstRow('graph', GRAPH_COLUMNS - 1)).toStartWith('◆ formatPrice')
    expect(modeIn('graph', { columns: 90, rows: GRAPH_ROWS })).toBe('graph')
    expect(modeIn('graph', { columns: 90, rows: GRAPH_ROWS - 1 })).toBe('tree')
    expect(modeIn('tree', { columns: 200, rows: 200 })).toBe('tree')
  })

  test('the shortest room the graph is drawn in shows two layers and counts the rest', () => {
    const rows = drawView(SHOP_MAP, 'graph', id('renderCart'), { columns: 90, rows: GRAPH_ROWS }).rows.map(rowText)
    expect(rows).toHaveLength(GRAPH_ROWS)
    expect([rows[0], rows.at(-1)]).toEqual(['↑ 2 more above', '↓ 2 more below'])
    expect(rows.join('\n')).toContain('◆ formatPrice')
  })
})

describe('sharing out the pane', () => {
  const LEGEND = ['◆ changed', '● breaks', '▲ review', '○ ok', '→ uses']
  const KEYS = ['←', '↓', '↑', '→', 'next flagged', 'tree view', 'ask Claude', 're-map', 'web page']
  const said = { summary: 'word '.repeat(30).trim(), hasNotice: false, legend: LEGEND, keys: KEYS }

  test('text is counted as it wraps at spaces, not by its length', () => {
    expect(wrappedRows('', 10)).toBe(0)
    expect(wrappedRows('fits here', 10)).toBe(1)
    expect(wrappedRows('aaaa bb cccc', 6)).toBe(3)
    expect(wrappedRows('a word-that-is-longer-than-the-row b', 10)).toBe(5)
    expect(wrappedRows(said.summary, 76)).toBe(2)
  })

  test('things laid side by side wrap onto a new row when the next one does not fit', () => {
    expect(flowRows([], 80)).toBe(0)
    expect(flowRows([10, 10, 10], 34)).toBe(1)
    expect(flowRows([10, 10, 10], 33)).toBe(2)
    expect(flowRows([40, 40, 40], 30)).toBe(3)
  })

  test('a roomy pane says everything and gives the map what is left', () => {
    expect(planOf({ columns: 76, rows: 40 }, said)).toEqual({
      isCompact: false,
      mapRows: 40 - 5 - 3 - 6,
      detail: { verdict: 2, links: 1 },
    })
    expect(planOf({ columns: 76, rows: 40 }, { ...said, hasNotice: true }).mapRows).toBe(40 - 15)
    expect(planOf({ columns: 76, rows: 40 }, { ...said, summary: '' }).mapRows).toBe(40 - 12)
  })

  test('the keys take one row where the pane is wide enough for them and more where it is not', () => {
    expect(planOf({ columns: 92, rows: 40 }, said).mapRows).toBe(planOf({ columns: 91, rows: 40 }, said).mapRows + 1)
    expect(planOf({ columns: 40, rows: 40 }, said).mapRows).toBe(40 - 2 - 4 - 2 - 3 - 4 - 3)
  })

  test('a short pane keeps the header, two rows on the selected node, and the keys, and the map takes the rest', () => {
    expect(planOf({ columns: 96, rows: 18 }, said)).toEqual({
      isCompact: true,
      mapRows: 18 - 1 - 2 - 1,
      detail: { verdict: 1, links: 0 },
    })
    expect(planOf({ columns: 76, rows: 18 }, { ...said, hasNotice: true }).mapRows).toBe(18 - 1 - 1 - 2 - 2)
  })

  test('however short the pane, the map keeps enough rows to show a node between its cut lines', () => {
    expect(planOf({ columns: 96, rows: 4 }, said).mapRows).toBe(5)
  })
})

describe('the detail under the map', () => {
  test('a flagged dependent says what it is, where, why it is flagged, and what it is linked to', () => {
    expect(detailOf(SHOP_MAP, node('renderCart'))).toEqual({
      name: 'renderCart',
      facts: 'function · untested',
      where: 'src/cart.ts:14',
      verdict: { text: 'breaks: passes 1 argument; formatPrice now takes 2', paint: 'breaks' },
      links: 'uses formatPrice · used by CheckoutPage',
    })
  })

  test('a changed symbol says what changed about it', () => {
    expect(detailOf(SHOP_MAP, node('formatPrice'))).toMatchObject({
      facts: 'function',
      verdict: { text: 'signature changed: gained a required currency parameter', paint: 'changed' },
      links: 'uses toFixed2, currencySymbol · used by renderCart, renderInvoice, priceLabel, emailReceipt',
    })
    const renamed = { ...node('formatPrice'), change: 'renamed' as const, reason: undefined }
    expect(detailOf(SHOP_MAP, renamed).verdict?.text).toBe('renamed')
  })

  test('a node that is fine has no verdict, and a dependency is never called untested', () => {
    expect(detailOf(SHOP_MAP, node('priceLabel')).verdict).toBeUndefined()
    const helper = detailOf(SHOP_MAP, { ...node('toFixed2'), isTested: false })
    expect(helper).toEqual({ name: 'toFixed2', facts: 'function', where: 'src/price.ts:9', links: 'used by formatPrice' })
  })
})
