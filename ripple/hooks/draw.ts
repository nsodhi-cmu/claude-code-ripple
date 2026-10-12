import type { RippleNode } from '../types'

// What both views draw with: rows of painted text, and the rectangles of them
// that select a node when clicked. Plain data, so a drawing crosses to the
// pane's surface module whole. Nothing here touches `$`.

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

export type Span = { text: string; paint: Paint; isBold?: true; isInverse?: true }

/** A rectangle of the drawing, in cells, and the node a click inside it selects. */
export type Hit = { id: string; x: number; y: number; width: number; height: number }

export type Drawing = { rows: Span[][]; hits: Hit[] }

/** The room a drawing may take, in cells. */
export type Room = { columns: number; rows: number }

/** A step of the selection, as the arrow keys name it. */
export type Move = 'left' | 'right' | 'up' | 'down'

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

export function markOf(node: RippleNode): Mark {
  if (node.role === 'changed') return MARKS.changed
  if (node.role === 'dependency') return MARKS.dependency
  return MARKS[node.risk]
}

export function locOf(node: RippleNode): string {
  return node.line > 0 ? `${node.file}:${node.line}` : node.file
}

/** Cuts `value` to `max` characters, the last one an ellipsis when anything was cut. */
export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value
}

/**
 * The run of `count` items, out of `total`, that holds item `keep`: grown
 * from it toward `toward` first, so what matters most stays in view.
 */
export function windowOf(total: number, count: number, keep: number, toward: number): [start: number, end: number] {
  let start = Math.min(Math.max(keep, 0), Math.max(total - 1, 0))
  let end = start + 1
  while (end - start < Math.min(count, total)) {
    const canGrowUp = start > 0
    const canGrowDown = end < total
    const wantsUp = toward < start || (toward >= start && toward < end && end - 1 - keep >= keep - start)
    if (canGrowUp && (wantsUp || !canGrowDown)) start -= 1
    else end += 1
  }
  return [start, end]
}

/** One row of dim text across the drawing: what a view shows where it had to cut. */
export function note(text: string): Span[] {
  return [{ text, paint: 'dim' }]
}

export function rowText(row: Span[]): string {
  return row.map(span => span.text).join('')
}
