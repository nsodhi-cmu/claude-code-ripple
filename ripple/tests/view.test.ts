import { describe, expect, test } from 'claude-code/testing'

import type { RippleMap } from '../types'
import { SHOP_MAP } from './fixture'
import { filesOf } from '../hooks/files'
import { GRAPH_COLUMNS, GRAPH_ROWS } from '../hooks/graph'
import { factsOf, flowRows, modeIn, nextFlagged, planOf, selectedOf, viewsOf, wrappedRows } from '../hooks/view'

const id = (name: string): string => node(name).id

const node = (name: string) => {
  const found = SHOP_MAP.nodes.find(one => one.name === name)
  if (found === undefined) throw new Error(`no symbol ${name}`)
  return found
}

const calm: RippleMap = { ...SHOP_MAP, nodes: SHOP_MAP.nodes.map(one => ({ ...one, risk: 'ok' as const })) }

describe('the selected symbol', () => {
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

  test('next flagged goes through what breaks, then what needs review, and round again', () => {
    const tour = [id('formatPrice')]
    for (let step = 0; step < 4; step += 1) tour.push(nextFlagged(SHOP_MAP, tour.at(-1) ?? null) ?? '')
    expect(tour.slice(1)).toEqual([id('renderCart'), id('renderInvoice'), id('emailReceipt'), id('renderCart')])
  })

  test('with nothing flagged the selection stays where it is', () => {
    expect(nextFlagged(calm, id('priceLabel'))).toBe(id('priceLabel'))
  })

  test('what is said of it under the list is what it is, what it uses, and what uses it', () => {
    expect(factsOf(SHOP_MAP, node('renderCart'))).toBe('function · uses formatPrice · used by CheckoutPage')
    expect(factsOf(SHOP_MAP, node('formatPrice'))).toBe(
      'function · uses toFixed2, currencySymbol · used by renderCart, renderInvoice, priceLabel, emailReceipt',
    )
    expect(factsOf(SHOP_MAP, { ...node('CheckoutPage'), kind: 'component' })).toBe('component · uses renderCart')
  })
})

describe('the views', () => {
  const shop = filesOf(SHOP_MAP)
  const room = { columns: 90, rows: 40 }
  const origin = { x: 0, y: 0 }

  test('the same key means each view\'s own direction: down a layer in the graph, down a row in the tree', () => {
    const views = viewsOf('pinned')
    expect(views.graph.step(shop, id('formatPrice'), 'down', room, origin)).toBe(id('currencySymbol'))
    expect(views.tree.step(shop, id('formatPrice'), 'down', room, origin)).toBe(id('renderCart'))
  })

  test('the graph scrolls as it is told to: pinned, a layer that fits never leaves the window; on a sheet it does', () => {
    const narrow = { columns: 44, rows: 40 }
    expect(viewsOf('pinned').graph.show(shop, id('CheckoutPage'), narrow, { x: 20, y: 0 })).toEqual({ x: 20, y: 0 })
    expect(viewsOf('sheet').graph.show(shop, id('CheckoutPage'), narrow, { x: 20, y: 0 })).toEqual({ x: 0, y: 0 })
  })

  test('a room too narrow or too short for the graph gets the tree instead', () => {
    expect(modeIn('graph', { columns: GRAPH_COLUMNS, rows: GRAPH_ROWS })).toBe('graph')
    expect(modeIn('graph', { columns: GRAPH_COLUMNS - 1, rows: 40 })).toBe('tree')
    expect(modeIn('graph', { columns: 90, rows: GRAPH_ROWS - 1 })).toBe('tree')
    expect(modeIn('tree', { columns: 200, rows: 200 })).toBe('tree')
  })
})

describe('sharing out the pane', () => {
  const LEGEND = ['◆ changed', '● breaks', '▲ review', '○ ok', '→ uses']
  const KEYS = ['←', '↓', '↑', '→', 'symbol ↑', 'symbol ↓', 'next flagged', 'tree view', 'ask Claude', 're-map', 'web page']
  /** What a pane 76 columns wide spends around the shop's map: six rows over it and ten under it, where it says everything. */
  const said = { summary: 'word '.repeat(30).trim(), hasNotice: false, legend: LEGEND, keys: KEYS, symbols: 2, mapNeeds: 18 }

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

  test('a pane says everything around the map where the map still gets the rows it needs, and not a row sooner', () => {
    expect(planOf({ columns: 76, rows: 34 }, said)).toMatchObject({ isCompact: false, mapRows: 18 })
    expect(planOf({ columns: 76, rows: 33 }, said)).toMatchObject({ isCompact: true, mapRows: 26 })
    expect(planOf({ columns: 76, rows: 24 }, { ...said, mapNeeds: 8 })).toMatchObject({ isCompact: false, mapRows: 8 })
  })

  test('a map too long to ever fit gets everything said once it has room for the deepest graph', () => {
    expect(planOf({ columns: 76, rows: 40 }, { ...said, mapNeeds: 200 })).toMatchObject({ isCompact: false, mapRows: 24 })
    expect(planOf({ columns: 76, rows: 39 }, { ...said, mapNeeds: 200 })).toMatchObject({ isCompact: true, mapRows: 32 })
  })

  test('a taller pane never shows less of a map that fits', () => {
    for (const mapNeeds of [5, 8, 13, 18, 23]) {
      let shown = 0
      for (let rows = 6; rows <= 70; rows += 1) {
        const now = Math.min(mapNeeds, planOf({ columns: 76, rows }, { ...said, mapNeeds }).mapRows)
        expect(now).toBeGreaterThanOrEqual(shown)
        shown = now
      }
      expect(shown).toBe(mapNeeds)
    }
  })

  test('a roomy pane says everything, lists as many symbols as the fullest file has, and gives the map what is left', () => {
    expect(planOf({ columns: 76, rows: 40 }, said)).toEqual({
      isCompact: false,
      mapTop: 6,
      mapRows: 24,
      listRows: 2,
      detailRows: 3,
    })
    expect(planOf({ columns: 76, rows: 40 }, { ...said, hasNotice: true })).toMatchObject({ mapTop: 7, mapRows: 23 })
    expect(planOf({ columns: 76, rows: 40 }, { ...said, summary: '' })).toMatchObject({ mapTop: 4, mapRows: 26 })
  })

  test('the list stops growing at a few rows, however many symbols one file holds', () => {
    expect(planOf({ columns: 76, rows: 40 }, { ...said, symbols: 26 })).toMatchObject({ listRows: 5, mapRows: 21 })
    expect(planOf({ columns: 96, rows: 18 }, { ...said, symbols: 26 })).toMatchObject({ listRows: 2, mapRows: 11 })
    expect(planOf({ columns: 76, rows: 40 }, { ...said, symbols: 0 }).listRows).toBe(1)
  })

  test('the keys take one row where the pane is wide enough for them and more where it is not', () => {
    expect(planOf({ columns: 118, rows: 40 }, said).mapRows).toBe(planOf({ columns: 117, rows: 40 }, said).mapRows + 1)
  })

  test('a short pane keeps the header, the list, a row for the reason, and the keys, and the map takes the rest', () => {
    expect(planOf({ columns: 96, rows: 18 }, said)).toEqual({
      isCompact: true,
      mapTop: 1,
      mapRows: 11,
      listRows: 2,
      detailRows: 1,
    })
    expect(planOf({ columns: 96, rows: 18 }, { ...said, hasNotice: true })).toMatchObject({ mapTop: 2, mapRows: 10 })
    expect(planOf({ columns: 96, rows: 18 }, { ...said, symbols: 1 })).toMatchObject({ listRows: 1, mapRows: 12 })
  })

  test('however short the pane, the map keeps a few rows', () => {
    expect(planOf({ columns: 96, rows: 4 }, said).mapRows).toBe(4)
  })
})
