import { describe, expect, test } from 'claude-code/testing'

import { beyondRow, clipStart, cutRow, markOf, reveal, rowText } from '../hooks/draw'
import type { Span } from '../hooks/draw'

describe('a window brought to what it must show', () => {
  test('one that already shows it stays where it is', () => {
    expect(reveal(10, 12, 20, 30, 100)).toBe(10)
    expect(reveal(10, 10, 40, 30, 100)).toBe(10)
  })

  test('one that does not moves just far enough to', () => {
    expect(reveal(10, 50, 60, 30, 100)).toBe(30)
    expect(reveal(40, 12, 20, 30, 100)).toBe(12)
  })

  test('what is longer than the window is shown from its start', () => {
    expect(reveal(0, 50, 95, 30, 100)).toBe(50)
    expect(reveal(80, 50, 95, 30, 100)).toBe(50)
  })

  test('a window that moves shows a margin past what it was moved for, and one that need not move ignores the margin', () => {
    expect(reveal(10, 50, 60, 30, 100, 4)).toBe(34)
    expect(reveal(40, 12, 20, 30, 100, 4)).toBe(8)
    expect(reveal(10, 30, 40, 30, 100, 4)).toBe(10)
    expect(reveal(10, 10, 20, 30, 100, 4)).toBe(10)
  })

  test('a window asked to stand between two cells stands on one', () => {
    expect(reveal(10.4, 12, 20, 30, 100)).toBe(10)
    expect(reveal(10.6, 50, 60, 30, 100)).toBe(30)
  })

  test('the window never leaves what it is a window on', () => {
    expect(reveal(0, 90, 110, 30, 100)).toBe(70)
    expect(reveal(50, -5, 3, 30, 100)).toBe(0)
    expect(reveal(5, 0, 10, 30, 20)).toBe(0)
  })
})

describe('the row that counts what is out of view', () => {
  const page = { x: 40, y: 5 }

  test('each count sits where a reader looks for it: the sides at the sides, above and below between them', () => {
    const { row, hits } = beyondRow({ left: 3, right: 12, above: 2, below: 5 }, 60, page, 9)
    expect(row).toEqual([{ text: '← 3 more            ↑ 2 more · ↓ 5 more            12 more →', paint: 'dim' }])
    expect(hits).toEqual([
      { x: 0, y: 9, width: 8, height: 1, by: { x: -40, y: 0 } },
      { x: 20, y: 9, width: 8, height: 1, by: { x: 0, y: -5 } },
      { x: 31, y: 9, width: 8, height: 1, by: { x: 0, y: 5 } },
      { x: 51, y: 9, width: 9, height: 1, by: { x: 40, y: 0 } },
    ])
  })

  test('a side with nothing past it is not spoken of, and takes no click', () => {
    const { row, hits } = beyondRow({ left: 0, right: 0, above: 0, below: 5 }, 30, page, 2)
    expect(rowText(row)).toBe('           ↓ 5 more')
    expect(hits).toEqual([{ x: 11, y: 2, width: 8, height: 1, by: { x: 0, y: 5 } }])
    expect(rowText(beyondRow({ left: 0, right: 7, above: 0, below: 0 }, 30, page, 0).row)).toBe(
      '                      7 more →',
    )
  })

  test('where the row is too narrow for every word, above and below keep their numbers and drop the word', () => {
    const { row, hits } = beyondRow({ left: 12, right: 12, above: 12, below: 12 }, 40, page, 0)
    expect(rowText(row)).toBe('← 12 more     ↑ 12 · ↓ 12      12 more →')
    expect(hits.map(hit => [hit.x, hit.width])).toEqual([
      [0, 9],
      [14, 4],
      [21, 4],
      [31, 9],
    ])
  })
})

describe('cutting text to fit', () => {
  const row: Span[] = [
    { text: '● ', paint: 'breaks' },
    { text: 'renderCart', paint: 'plain', isBold: true },
    { text: '  :14  breaks', paint: 'dim' },
  ]

  test('a row that fits is left as it is', () => {
    expect(cutRow(row, 25)).toBe(row)
  })

  test('a longer row is cut to the room, each run keeping its paint, and ends in an ellipsis', () => {
    expect(cutRow(row, 16)).toEqual([
      { text: '● ', paint: 'breaks' },
      { text: 'renderCart', paint: 'plain', isBold: true },
      { text: '  :', paint: 'dim' },
      { text: '…', paint: 'dim' },
    ])
    expect(rowText(cutRow(row, 8))).toBe('● rende…')
  })

  test('a path is cut from its start, so that the file\'s own name stays', () => {
    expect(clipStart('services/billing/src/invoice/Invoice.java', 24)).toBe('…rc/invoice/Invoice.java')
    expect(clipStart('src/cart.ts', 24)).toBe('src/cart.ts')
  })
})

describe('marks', () => {
  test('a file is marked as a symbol of its role and risk would be', () => {
    expect(markOf({ role: 'dependent', risk: 'breaks' })).toEqual({ glyph: '●', paint: 'breaks' })
    expect(markOf({ role: 'dependent', risk: 'ok' })).toEqual({ glyph: '○', paint: 'plain' })
    expect(markOf({ role: 'dependency', risk: 'ok' })).toEqual({ glyph: '→', paint: 'dim' })
  })

  test('what changed and is itself at risk keeps the mark of a change, in the color of the risk', () => {
    expect(markOf({ role: 'changed', risk: 'ok' })).toEqual({ glyph: '◆', paint: 'changed' })
    expect(markOf({ role: 'changed', risk: 'review' })).toEqual({ glyph: '◆', paint: 'review' })
  })
})
