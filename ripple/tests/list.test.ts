import { describe, expect, test } from 'claude-code/testing'

import type { RippleNode } from '../types'
import { SHOP_MAP } from './fixture'
import { rowText } from '../hooks/draw'
import { fileOf, filesOf } from '../hooks/files'
import type { MapFile } from '../hooks/files'
import { drawList, listSays, scrollList, showInList, stepInList } from '../hooks/list'

const symbol = (name: string, line: number, rest: Partial<RippleNode> = {}): RippleNode => ({
  id: name,
  name,
  kind: 'function',
  file: 'src/plans.ts',
  line,
  role: 'dependent',
  depth: 1,
  risk: 'ok',
  isTested: true,
  ...rest,
})

/** A file with a change in it, four symbols that use the change, and one the change uses. */
const PLANS = ((): MapFile => {
  const map = filesOf({
    method: 'lsp',
    nodes: [
      symbol('renewPlan', 88, { risk: 'breaks', isTested: false, reason: 'passes 1 argument; prorate now takes 2' }),
      symbol('prorate', 12, { role: 'changed', depth: 0, change: 'signature', reason: 'gained a required rounding mode' }),
      symbol('cancelPlan', 140, { risk: 'review', reason: 'refunds through prorate' }),
      symbol('previewPlan', 61),
      symbol('daysIn', 7, { role: 'dependency', isTested: false }),
      symbol('upgradePlan', 203, { isTested: false }),
    ],
    edges: [],
  })
  const [file] = map.files
  if (file === undefined) throw new Error('no file')
  return file
})()

const rows = (file: MapFile, selected: string | null, room: { columns: number; rows: number }, top: number): string[] =>
  drawList(file, selected, room, top).rows.map(rowText)

describe('the list', () => {
  test('a row a symbol, in the order they stand in the file: its mark, its name, its line, and what to know of it', () => {
    expect(rows(PLANS, 'renewPlan', { columns: 80, rows: 10 }, 0)).toEqual([
      '  → daysIn       :7',
      '  ◆ prorate      :12   signature changed',
      '  ○ previewPlan  :61',
      '  ● renewPlan    :88   breaks · untested',
      '  ▲ cancelPlan   :140  review',
      '  ○ upgradePlan  :203  untested',
    ])
  })

  test('the selected symbol\'s name is marked, and each row is painted by its own risk', () => {
    const drawing = drawList(PLANS, 'renewPlan', { columns: 80, rows: 10 }, 0)
    expect(drawing.rows[3]).toEqual([
      { text: '  ', paint: 'dim' },
      { text: '● ', paint: 'breaks' },
      { text: 'renewPlan', paint: 'plain', isBold: true, isInverse: true },
      { text: '    :88', paint: 'dim' },
      { text: '   breaks · untested', paint: 'breaks' },
    ])
    expect(drawing.rows[5]?.at(-1)).toEqual({ text: '  untested', paint: 'dim' })
    expect(drawing.rows[1]?.at(-1)?.paint).toBe('changed')
  })

  test('every row is a hit across the room for its own symbol', () => {
    expect(drawList(PLANS, null, { columns: 40, rows: 3 }, 2).hits).toEqual([
      { id: 'previewPlan', x: 0, y: 0, width: 40, height: 1 },
      { id: 'renewPlan', x: 0, y: 1, width: 40, height: 1 },
      { id: 'cancelPlan', x: 0, y: 2, width: 40, height: 1 },
    ])
  })

  test('a row longer than the room ends in an ellipsis', () => {
    expect(rows(PLANS, null, { columns: 34, rows: 10 }, 0)[3]).toBe('  ● renewPlan    :88   breaks · u…')
  })

  test('a symbol with no line to give has none drawn', () => {
    const unplaced = { ...SHOP_MAP, nodes: SHOP_MAP.nodes.map(one => ({ ...one, line: 0 })) }
    const ui = fileOf(filesOf(unplaced), 'src/ui.ts:priceLabel')
    if (ui === undefined) throw new Error('no ui.ts')
    expect(rows(ui, null, { columns: 60, rows: 3 }, 0)).toEqual(['  ○ priceLabel'])
  })
})

describe('a list longer than its rows', () => {
  const room = { columns: 30, rows: 3 }

  test('the first and last rows say when there are more symbols above and below them', () => {
    expect(rows(PLANS, null, room, 0).map(row => row.slice(0, 13))).toEqual(['  → daysIn   ', '  ◆ prorate  ', '↓ ○ previewPl'])
    expect(rows(PLANS, null, room, 2).map(row => row[0])).toEqual(['↑', ' ', '↓'])
    expect(rows(PLANS, null, room, 3).map(row => row[0])).toEqual(['↑', ' ', ' '])
    expect(rows(PLANS, null, { columns: 30, rows: 1 }, 2).map(row => row[0])).toEqual(['↕'])
  })

  test('what is said over the list counts the symbols, or with more than it shows, says which of them it shows', () => {
    expect(listSays(PLANS, 6, 0)).toBe('6 symbols')
    expect(listSays(PLANS, 3, 0)).toBe('symbols 1–3 of 6')
    expect(listSays(PLANS, 3, 2)).toBe('symbols 3–5 of 6')
    expect(listSays(PLANS, 3, 40)).toBe('symbols 4–6 of 6')
    const cart = fileOf(filesOf(SHOP_MAP), 'src/cart.ts:renderCart')
    expect(cart === undefined ? '' : listSays(cart, 3, 0)).toBe('1 symbol')
  })

  test('the list moves no farther than it must to show the selected symbol', () => {
    expect(showInList(PLANS, 'daysIn', 3, 0)).toBe(0)
    expect(showInList(PLANS, 'previewPlan', 3, 0)).toBe(0)
    expect(showInList(PLANS, 'renewPlan', 3, 0)).toBe(1)
    expect(showInList(PLANS, 'upgradePlan', 3, 0)).toBe(3)
    expect(showInList(PLANS, 'renewPlan', 3, 3)).toBe(3)
    expect(showInList(PLANS, 'prorate', 3, 3)).toBe(1)
  })

  test('scrolling stops at the first symbol and at the last', () => {
    expect(scrollList(PLANS, 3, 0, 2)).toBe(2)
    expect(scrollList(PLANS, 3, 2, 5)).toBe(3)
    expect(scrollList(PLANS, 3, 2, -9)).toBe(0)
    expect(scrollList(PLANS, 10, 0, 4)).toBe(0)
  })
})

describe('moving through the list', () => {
  test('up and down go through the file\'s symbols and stop at its ends', () => {
    expect(stepInList(PLANS, 'prorate', 'down')).toBe('previewPlan')
    expect(stepInList(PLANS, 'prorate', 'up')).toBe('daysIn')
    expect(stepInList(PLANS, 'daysIn', 'up')).toBe('daysIn')
    expect(stepInList(PLANS, 'upgradePlan', 'down')).toBe('upgradePlan')
  })
})
