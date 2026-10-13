import type { RippleNode } from '../types'
import type { FileMap } from './files'

// What the views draw with: rows of painted text, and the rectangles of them
// that answer a click. Plain data, so a drawing crosses to the pane's surface
// module whole.

/** How a run of text is painted; the pane gives each paint the surface's own color. */
export type Paint = 'plain' | 'dim' | 'changed' | 'breaks' | 'review' | 'accent'

/** The color each paint takes: a theme key, so it follows the person's theme. */
export const COLORS: Readonly<Record<Paint, string | undefined>> = {
  plain: undefined,
  dim: undefined,
  changed: 'suggestion',
  breaks: 'error',
  review: 'warning',
  accent: 'claude',
}

/** A run of text in one paint. */
export type Span = { text: string; paint: Paint; isBold?: true; isInverse?: true }

/** Where a window stands over something larger than it, or how far it is to move: in cells. */
export type Pan = { x: number; y: number }

/** A rectangle of the drawing, in cells, and what a click inside it does: selects symbol `id`, or scrolls the map `by`. */
export type Hit = { x: number; y: number; width: number; height: number } & ({ id: string } | { by: Pan })

/** A view's picture: its rows, top to bottom, and where a click does what. */
export type Drawing = { rows: Span[][]; hits: Hit[] }

/** The room a drawing may take, in cells. */
export type Room = { columns: number; rows: number }

/** A step of the selection, as the arrow keys name it. */
export type Move = 'left' | 'right' | 'up' | 'down'

/** What a view of the map does. `selected` is a symbol's id: its file is the one selected. */
export type View = {
  /** Draws the map through a window at `pan`. */
  draw: (map: FileMap, selected: string | null, room: Room, pan: Pan) => Drawing
  /** Where the window stands to show the selected file: as near `from` as it can. */
  show: (map: FileMap, selected: string | null, room: Room, from: Pan) => Pan
  /** Where the window stands after it is scrolled from `from`: by cells, or by turns of the wheel. */
  scroll: (map: FileMap, room: Room, from: Pan, by: Pan | number) => Pan
  /** The symbol a move from the selected file lands on: the first of the file it reaches. */
  step: (map: FileMap, selected: string | null, move: Move, room: Room, pan: Pan) => string | null
}

/** The sign a file or a symbol is drawn with. */
export type Mark = { glyph: string; paint: Paint }

const MARKS = {
  changed: { glyph: '◆', paint: 'changed' },
  breaks: { glyph: '●', paint: 'breaks' },
  review: { glyph: '▲', paint: 'review' },
  ok: { glyph: '○', paint: 'plain' },
  dependency: { glyph: '→', paint: 'dim' },
} as const satisfies Record<string, Mark>

/** The legend, in the order a reader should worry about them. */
export const LEGEND: ReadonlyArray<Mark & { label: string }> = [
  { ...MARKS.changed, label: 'changed' },
  { ...MARKS.breaks, label: 'breaks' },
  { ...MARKS.review, label: 'review' },
  { ...MARKS.ok, label: 'ok' },
  { ...MARKS.dependency, label: 'uses' },
]

/** The mark of a symbol, or of a file. What changed and is itself at risk keeps its glyph and takes the risk's paint. */
export function markOf(at: Pick<RippleNode, 'role' | 'risk'>): Mark {
  if (at.role === 'dependency') return MARKS.dependency
  if (at.role === 'dependent') return MARKS[at.risk]
  return at.risk === 'ok' ? MARKS.changed : { glyph: MARKS.changed.glyph, paint: MARKS[at.risk].paint }
}

export function locOf(node: RippleNode): string {
  return node.line > 0 ? `${node.file}:${node.line}` : node.file
}

/**
 * What to know of a symbol beyond its name: how a changed one changed, the
 * risk of a flagged one, and whether it lacks a test.
 */
export function wordsOf(node: RippleNode): string[] {
  const words: string[] = []
  if (node.role === 'changed') {
    const isAspect = node.change === 'signature' || node.change === 'behavior'
    words.push(isAspect ? `${node.change} changed` : (node.change ?? 'changed'))
  }
  if (node.risk !== 'ok') words.push(node.risk)
  if (!node.isTested && node.role !== 'dependency') words.push('untested')
  return words
}

/**
 * Where a window `size` long over `total` stands to show `start` to `end`. A
 * window at `from` that already shows them stays there; one that does not
 * moves just far enough to show them and `margin` more on each side. What is
 * longer than the window is shown from its start.
 */
export function reveal(from: number, start: number, end: number, size: number, total: number, margin = 0): number {
  const most = Math.max(0, total - size)
  const at = Math.min(Math.max(Math.round(from), 0), most)
  if (start >= at && end <= at + size) return at
  const shown = Math.min(Math.max(at, end + margin - size), start - margin)
  return Math.min(Math.max(shown, 0), most)
}

/** How many files lie past each edge of a window. */
export type Beyond = { left: number; right: number; above: number; below: number }

/**
 * The row under a map larger than its room: how many files lie past each
 * edge, the sides' at the sides and the others between them. A click on a
 * count scrolls the map a `page` that way.
 */
export function beyondRow(beyond: Beyond, columns: number, page: Pan, y: number): { row: Span[]; hits: Hit[] } {
  const left = beyond.left > 0 ? `← ${beyond.left} more` : ''
  const right = beyond.right > 0 ? `${beyond.right} more →` : ''
  const between = (more: string): string[] => [
    ...(beyond.above > 0 ? [`↑ ${beyond.above}${more}`] : []),
    ...(beyond.below > 0 ? [`↓ ${beyond.below}${more}`] : []),
  ]
  const room = columns - left.length - right.length - 4
  const [first = '', second = ''] = between(' more').join(' · ').length <= room ? between(' more') : between('')
  const middle = first === '' || second === '' ? first + second : `${first} · ${second}`
  const start = Math.max(left === '' ? 0 : left.length + 2, Math.floor((columns - middle.length) / 2))
  const gap = Math.max(1, columns - start - middle.length - right.length)

  const hits: Hit[] = []
  const hit = (text: string, x: number, by: Pan): void => {
    if (text !== '') hits.push({ x, y, width: text.length, height: 1, by })
  }
  hit(left, 0, { x: -page.x, y: 0 })
  hit(beyond.above > 0 ? first : '', start, { x: 0, y: -page.y })
  hit(beyond.below > 0 ? (beyond.above > 0 ? second : first) : '', start + middle.length - (second || first).length, {
    x: 0,
    y: page.y,
  })
  hit(right, start + middle.length + gap, { x: page.x, y: 0 })
  const text = `${left.padEnd(start)}${middle}${' '.repeat(gap)}${right}`
  return { row: [{ text: text.trimEnd(), paint: 'dim' }], hits }
}

export function rowText(row: Span[]): string {
  return row.map(span => span.text).join('')
}

/** A name cut to `max` characters from its middle, so that it keeps how it starts and how it ends. */
export function clipMiddle(name: string, max: number): string {
  const characters = [...name]
  if (characters.length <= max) return name
  const kept = Math.max(0, max - 1)
  const head = characters.slice(0, Math.ceil(kept / 2)).join('')
  return `${head}…${characters.slice(characters.length - Math.floor(kept / 2)).join('')}`
}

/** A path cut to `max` characters from its start, where it says least of the file. */
export function clipStart(path: string, max: number): string {
  const characters = [...path]
  return characters.length > max ? `…${characters.slice(characters.length - Math.max(0, max - 1)).join('')}` : path
}

/** A row cut to `columns`, the last of them an ellipsis when anything was cut. */
export function cutRow(row: Span[], columns: number): Span[] {
  if ([...rowText(row)].length <= columns) return row
  const cut: Span[] = []
  let room = Math.max(0, columns - 1)
  for (const span of row) {
    if (room === 0) break
    const characters = [...span.text].slice(0, room)
    cut.push({ ...span, text: characters.join('') })
    room -= characters.length
  }
  return [...cut, { text: '…', paint: 'dim' }]
}
