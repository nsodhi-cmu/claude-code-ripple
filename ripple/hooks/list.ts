import type { RippleNode } from '../types'
import { cutRow, markOf, reveal, wordsOf } from './draw'
import type { Drawing, Hit, Move, Room, Span } from './draw'
import type { MapFile } from './files'
import { clip, plural } from './map'

// The list under the map: the symbols of the selected file, a row each, with
// the line each is on and what to know of it.

/** The most characters of a symbol's name a row shows. */
const NAME_CHARS = 28

const topIn = (file: MapFile, rows: number, top: number): number =>
  Math.min(Math.max(Math.round(top), 0), Math.max(0, file.symbols.length - rows))

/** `2 symbols`, or with more than the list shows at once, which of them it shows: `symbols 3–5 of 9`. */
export function listSays(file: MapFile, rows: number, top: number): string {
  const total = file.symbols.length
  if (total <= rows) return plural(total, 'symbol')
  const first = topIn(file, rows, top)
  return `symbols ${first + 1}–${first + rows} of ${total}`
}

/**
 * Draws the file's symbols from the one at `top`, in the order they stand in
 * the file. The first and last rows say, before their marks, when there are
 * more symbols above and below them.
 */
export function drawList(file: MapFile, selected: string | null, room: Room, top: number): Drawing {
  const first = topIn(file, room.rows, top)
  const shown = file.symbols.slice(first, first + room.rows)
  const nameColumns = Math.max(0, ...file.symbols.map(symbol => clip(symbol.name, NAME_CHARS).length))
  const lineOf = (symbol: RippleNode): string => (symbol.line > 0 ? `:${symbol.line}` : '')
  const lineColumns = Math.max(0, ...file.symbols.map(symbol => lineOf(symbol).length))

  const rows: Span[][] = []
  const hits: Hit[] = []
  shown.forEach((symbol, index) => {
    const mark = markOf(symbol)
    const name = clip(symbol.name, NAME_CHARS)
    const hasAbove = index === 0 && first > 0
    const hasBelow = index === shown.length - 1 && first + shown.length < file.symbols.length
    const [line, words] = [lineOf(symbol), wordsOf(symbol).join(' · ')]
    const spans: Span[] = [
      { text: `${hasAbove && hasBelow ? '↕' : hasAbove ? '↑' : hasBelow ? '↓' : ' '} `, paint: 'dim' },
      { text: `${mark.glyph} `, paint: mark.paint },
      { text: name, paint: 'plain', ...(symbol.id === selected ? { isBold: true as const, isInverse: true as const } : {}) },
    ]
    if (line !== '' || words !== '') {
      spans.push({ text: `${' '.repeat(nameColumns - name.length + 2)}${line}`, paint: 'dim' })
    }
    if (words !== '') {
      const gap = ' '.repeat(lineColumns - line.length + 2)
      spans.push({ text: `${gap}${words}`, paint: mark.paint === 'plain' ? 'dim' : mark.paint })
    }
    hits.push({ id: symbol.id, x: 0, y: rows.length, width: room.columns, height: 1 })
    rows.push(cutRow(spans, room.columns))
  })
  return { rows, hits }
}

/** The symbol the list starts from to show the selected one: as near `from` as it can. */
export function showInList(file: MapFile, selected: string | null, rows: number, from: number): number {
  const at = Math.max(
    0,
    file.symbols.findIndex(symbol => symbol.id === selected),
  )
  return reveal(topIn(file, rows, from), at, at + 1, rows, file.symbols.length)
}

/** The symbol the list starts from after it is scrolled `by` rows from `from`. */
export function scrollList(file: MapFile, rows: number, from: number, by: number): number {
  return topIn(file, rows, topIn(file, rows, from) + by)
}

/** The symbol a move up or down the list from the selected one lands on. */
export function stepInList(file: MapFile, selected: string | null, move: Move): string | null {
  const at = file.symbols.findIndex(symbol => symbol.id === selected)
  return file.symbols[at + (move === 'up' ? -1 : move === 'down' ? 1 : 0)]?.id ?? selected
}
