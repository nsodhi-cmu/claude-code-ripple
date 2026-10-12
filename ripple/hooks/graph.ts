import type { RippleNode, RippleReport } from '../types'
import { clip, markOf, note, windowOf } from './draw'
import type { Drawing, Hit, Move, Paint, Room, Span } from './draw'
import { rankOf } from './map'

// The graph view: the map as boxes in layers along the flow of use, dependents
// above the change and dependencies below it, with the edges between
// neighboring layers drawn in box characters. Nothing here touches `$`.

/** The most characters of a name a box shows. */
const NAME_CHARS = 20
/** A box is its label, a space and a border on each side. */
const BOX_PADDING = 4
/** The room between two boxes of a layer, where the layer has it to spare. */
const BOX_GAP = 2
const BOX_ROWS = 3
/** Between two layers: a row the edges run along, and a row of arrowheads. */
const EDGE_ROWS = 2
/** The narrowest room the graph is drawn in: one box of the widest kind beside a fold box. */
export const GRAPH_COLUMNS = 40
/** The shortest: two layers and the edges between them, between two lines that count what was cut. */
export const GRAPH_ROWS = 2 * BOX_ROWS + EDGE_ROWS + 2
/** Where a node with no link to the layer nearer the change is sorted: after those that have one. */
const UNLINKED = Number.MAX_SAFE_INTEGER

/**
 * The map in layers, far dependents first, each layer ordered to sit by what
 * it is linked to in the layer nearer the change, so edges cross less.
 */
export function layersOf(report: RippleReport): RippleNode[][] {
  const byRank = new Map<number, RippleNode[]>()
  for (const node of report.nodes) byRank.set(rankOf(node), [...(byRank.get(rankOf(node)) ?? []), node])
  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  const outward = [...ranks.filter(rank => rank >= 0), ...ranks.filter(rank => rank < 0).reverse()]

  for (const rank of outward) {
    const layer = byRank.get(rank) ?? []
    const nearer = rank === 0 ? [] : (byRank.get(rank < 0 ? rank + 1 : rank - 1) ?? [])
    const placeOf = new Map(nearer.map((node, index) => [node.id, index]))
    const pullOf = (node: RippleNode): number => {
      const places = report.edges.flatMap(edge => {
        const other = rank < 0 ? (edge.from === node.id ? edge.to : '') : edge.to === node.id ? edge.from : ''
        const place = placeOf.get(other)
        return place === undefined ? [] : [place]
      })
      return places.length === 0 ? UNLINKED : places.reduce((sum, place) => sum + place, 0) / places.length
    }
    const pulls = new Map(layer.map(node => [node.id, pullOf(node)]))
    byRank.set(
      rank,
      layer
        .map((node, index) => ({ node, index }))
        .sort((a, b) => (pulls.get(a.node.id) ?? 0) - (pulls.get(b.node.id) ?? 0) || a.index - b.index)
        .map(entry => entry.node),
    )
  }
  return ranks.map(rank => byRank.get(rank) ?? [])
}

function labelOf(node: RippleNode): string {
  return `${markOf(node).glyph} ${clip(node.name, NAME_CHARS)}`
}

function widthOf(node: RippleNode): number {
  return labelOf(node).length + BOX_PADDING
}

/** The box that stands for the nodes a layer had no room for. */
function foldLabel(count: number): string {
  return `+${count} more`
}

function riskiest(nodes: RippleNode[]): Paint {
  if (nodes.some(node => node.risk === 'breaks')) return 'breaks'
  return nodes.some(node => node.risk === 'review') ? 'review' : 'dim'
}

/**
 * The nodes of a layer that fit across `columns`, in their order, and the
 * rest. The selected node is kept first, then what it is linked to, then the
 * others; among each, what breaks before what needs review before the rest.
 */
function fit(
  layer: RippleNode[],
  columns: number,
  selected: string | null,
  near: ReadonlySet<string>,
): { shown: RippleNode[]; folded: RippleNode[] } {
  const whole = layer.reduce((sum, node) => sum + widthOf(node), 0) + (layer.length - 1)
  if (whole <= columns) return { shown: layer, folded: [] }
  const weight = (node: RippleNode): number => {
    if (node.id === selected) return -1
    return (near.has(node.id) ? 0 : 3) + (node.risk === 'breaks' ? 0 : node.risk === 'review' ? 1 : 2)
  }
  const kept = new Set<string>()
  let used = foldLabel(layer.length).length + BOX_PADDING
  for (const { node } of layer
    .map((node, index) => ({ node, index }))
    .sort((a, b) => weight(a.node) - weight(b.node) || a.index - b.index)) {
    const needed = widthOf(node) + 1
    if (kept.size > 0 && used + needed > columns) continue
    kept.add(node.id)
    used += needed
  }
  return { shown: layer.filter(node => kept.has(node.id)), folded: layer.filter(node => !kept.has(node.id)) }
}

type Cell = { char: string; paint: Paint; isBold?: true; isInverse?: true }

/** Which ways an edge leaves a cell; a cell several edges share shows all of theirs. */
const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8

const LINES: Record<number, string> = {
  [UP]: '│',
  [DOWN]: '│',
  [UP | DOWN]: '│',
  [LEFT]: '─',
  [RIGHT]: '─',
  [LEFT | RIGHT]: '─',
  [DOWN | RIGHT]: '┌',
  [DOWN | LEFT]: '┐',
  [UP | RIGHT]: '└',
  [UP | LEFT]: '┘',
  [UP | DOWN | RIGHT]: '├',
  [UP | DOWN | LEFT]: '┤',
  [DOWN | LEFT | RIGHT]: '┬',
  [UP | LEFT | RIGHT]: '┴',
  [UP | DOWN | LEFT | RIGHT]: '┼',
}

type Frame = { corners: string; across: string; down: string; exit: string }

const FRAMES = {
  plain: { corners: '┌┐└┘', across: '─', down: '│', exit: '┬' },
  selected: { corners: '╔╗╚╝', across: '═', down: '║', exit: '╤' },
  fold: { corners: '┌┐└┘', across: '╌', down: '╎', exit: '╌' },
} as const satisfies Record<string, Frame>

type Box = {
  /** The node a click on the box selects. */
  id: string
  /** Every node the box stands for: itself, or all that a fold box holds. */
  ids: string[]
  x: number
  width: number
  label: string
  paint: Paint
  frame: Frame
  isSelected: boolean
}

function borderOf(box: Box): Paint {
  if (box.isSelected) return 'accent'
  return box.paint === 'plain' ? 'dim' : box.paint
}

function spansOf(cells: Cell[]): Span[] {
  let end = cells.length
  while (end > 0 && cells[end - 1]?.char === ' ') end -= 1
  const spans: Span[] = []
  for (const cell of cells.slice(0, end)) {
    const last = spans.at(-1)
    if (last !== undefined && last.paint === cell.paint && last.isBold === cell.isBold && last.isInverse === cell.isInverse) {
      last.text += cell.char
    } else {
      spans.push({
        text: cell.char,
        paint: cell.paint,
        ...(cell.isBold ? { isBold: true as const } : {}),
        ...(cell.isInverse ? { isInverse: true as const } : {}),
      })
    }
  }
  return spans
}

function boxesOf(layer: RippleNode[], columns: number, selected: string | null, near: ReadonlySet<string>): Box[] {
  const { shown, folded } = fit(layer, columns, selected, near)
  const boxes: Box[] = shown.map(node => ({
    id: node.id,
    ids: [node.id],
    x: 0,
    width: widthOf(node),
    label: labelOf(node),
    paint: markOf(node).paint,
    frame: node.id === selected ? FRAMES.selected : FRAMES.plain,
    isSelected: node.id === selected,
  }))
  const [first] = folded
  if (first !== undefined) {
    boxes.push({
      id: first.id,
      ids: folded.map(node => node.id),
      x: 0,
      width: foldLabel(folded.length).length + BOX_PADDING,
      label: foldLabel(folded.length),
      paint: riskiest(folded),
      frame: FRAMES.fold,
      isSelected: false,
    })
  }
  return boxes
}

const centerOf = (box: Box): number => box.x + Math.floor(box.width / 2)

/**
 * Seats a layer's boxes across `columns`, each as near as it can be to the
 * middle of the boxes of `beside` it is linked to, so that edges run short
 * and straight; with no layer beside it, the layer is centered.
 */
function seat(boxes: Box[], columns: number, beside: Box[], isLinked: (box: Box, other: Box) => boolean): void {
  const across = boxes.reduce((sum, box) => sum + box.width, 0)
  const gap = across + BOX_GAP * (boxes.length - 1) <= columns ? BOX_GAP : 1
  const wanted = boxes.map(box => {
    const linked = beside.filter(other => isLinked(box, other))
    if (linked.length === 0) return undefined
    return Math.round(linked.reduce((sum, other) => sum + centerOf(other), 0) / linked.length) - Math.floor(box.width / 2)
  })
  const hasWants = wanted.some(want => want !== undefined)
  let x = hasWants ? 0 : Math.max(0, Math.floor((columns - across - gap * (boxes.length - 1)) / 2))
  boxes.forEach((box, index) => {
    box.x = Math.max(x, wanted[index] ?? x)
    x = box.x + box.width + gap
  })
  let limit = columns
  for (const box of [...boxes].reverse()) {
    box.x = Math.max(0, Math.min(box.x, limit - box.width))
    limit = box.x - gap
  }
  // Pushing boxes apart leaves them off to one side of what they wanted: slide the layer back.
  const offsets = boxes.flatMap((box, index) => (wanted[index] === undefined ? [] : [(wanted[index] ?? 0) - box.x]))
  const [first, last] = [boxes[0], boxes.at(-1)]
  if (offsets.length === 0 || first === undefined || last === undefined) return
  const mean = Math.round(offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length)
  const slide = Math.max(-first.x, Math.min(mean, columns - last.x - last.width))
  for (const box of boxes) box.x += slide
}

/** Draws the map as a graph in `room`, around the selected node. */
export function drawGraph(report: RippleReport, selected: string | null, room: Room): Drawing {
  const layers = layersOf(report)
  if (layers.length === 0) return { rows: [], hits: [] }
  const columns = Math.max(room.columns, GRAPH_COLUMNS)
  const near = new Set(
    report.edges.flatMap(edge => (edge.from === selected ? [edge.to] : edge.to === selected ? [edge.from] : [])),
  )

  // Which layers fit down the room: as many as do, around the selected one and toward the change.
  const heightOf = (count: number): number => count * BOX_ROWS + (count - 1) * EDGE_ROWS
  const selectedLayer = layers.findIndex(layer => layer.some(node => node.id === selected))
  const changedLayer = Math.max(
    0,
    layers.findIndex(layer => layer.some(node => node.role === 'changed')),
  )
  const keep = selectedLayer === -1 ? changedLayer : selectedLayer
  let [start, end] = [0, layers.length]
  for (let count = layers.length; count >= 1; count -= 1) {
    ;[start, end] = windowOf(layers.length, count, keep, changedLayer)
    const cut = (start > 0 ? 1 : 0) + (end < layers.length ? 1 : 0)
    if (heightOf(count) + cut <= room.rows) break
  }
  const top = start > 0 ? 1 : 0
  const height = top + heightOf(end - start) + (end < layers.length ? 1 : 0)

  // Seat the layer nearest the change first, then each layer by the one it was seated against.
  const placed = layers.slice(start, end).map((layer, index) => ({
    y: top + index * (BOX_ROWS + EDGE_ROWS),
    boxes: boxesOf(layer, columns, selected, near),
  }))
  const uses = (upper: Box, lower: Box): boolean =>
    report.edges.some(edge => upper.ids.includes(edge.from) && lower.ids.includes(edge.to))
  const middle = Math.min(Math.max(changedLayer - start, 0), placed.length - 1)
  placed.forEach((_, step) => {
    for (const index of step === 0 ? [middle] : [middle - step, middle + step]) {
      const layer = placed[index]
      if (layer === undefined) continue
      const beside = step === 0 ? [] : (placed[index < middle ? index + 1 : index - 1]?.boxes ?? [])
      seat(layer.boxes, columns, beside, (box, other) => (index < middle ? uses(box, other) : uses(other, box)))
    }
  })

  const cells: Cell[][] = Array.from({ length: height }, () =>
    Array.from({ length: columns }, () => ({ char: ' ', paint: 'plain' as Paint })),
  )
  const put = (x: number, y: number, text: string, style: Omit<Cell, 'char'>): void => {
    ;[...text].forEach((char, index) => {
      const row = cells[y]
      if (row !== undefined && x + index >= 0 && x + index < columns) row[x + index] = { char, ...style }
    })
  }

  const hits: Hit[] = []
  for (const { y, boxes } of placed) {
    for (const box of boxes) {
      const border = { paint: borderOf(box) }
      const [topLeft = '', topRight = '', bottomLeft = '', bottomRight = ''] = box.frame.corners
      const bar = box.frame.across.repeat(box.width - 2)
      put(box.x, y, `${topLeft}${bar}${topRight}`, border)
      put(box.x, y + 1, box.frame.down, border)
      put(box.x + box.width - 1, y + 1, box.frame.down, border)
      put(box.x, y + 2, `${bottomLeft}${bar}${bottomRight}`, border)
      put(box.x + 2, y + 1, box.label, {
        paint: box.paint,
        ...(box.isSelected ? { isBold: true as const, isInverse: true as const } : {}),
      })
      hits.push({ id: box.id, x: box.x, y, width: box.width, height: BOX_ROWS })
    }
  }

  // The edges between each layer and the one under it, lit where they touch the selected node.
  placed.slice(0, -1).forEach((upper, index) => {
    const lower = placed[index + 1]
    if (lower === undefined) return
    const runY = upper.y + BOX_ROWS
    const ways = new Map<number, { ways: number; isLit: boolean }>()
    const mark = (x: number, way: number, isLit: boolean): void => {
      const at = ways.get(x) ?? { ways: 0, isLit: false }
      ways.set(x, { ways: at.ways | way, isLit: at.isLit || isLit })
    }
    for (const from of upper.boxes) {
      for (const to of lower.boxes.filter(box => uses(from, box))) {
        const isLit = from.isSelected || to.isSelected
        const into = centerOf(to)
        // Straight down where the box above reaches over the one below; else out of its middle.
        const out = into > from.x && into < from.x + from.width - 1 ? into : centerOf(from)
        put(out, upper.y + BOX_ROWS - 1, from.frame.exit, { paint: isLit ? 'accent' : borderOf(from) })
        mark(out, UP, isLit)
        mark(into, DOWN, isLit)
        for (let x = Math.min(out, into); x <= Math.max(out, into); x += 1) {
          if (x > Math.min(out, into)) mark(x, LEFT, isLit)
          if (x < Math.max(out, into)) mark(x, RIGHT, isLit)
        }
        if (isLit || cells[runY + 1]?.[into]?.char !== '▼') put(into, runY + 1, '▼', { paint: isLit ? 'accent' : 'dim' })
      }
    }
    for (const [x, at] of ways) put(x, runY, LINES[at.ways] ?? ' ', { paint: at.isLit ? 'accent' : 'dim' })
  })

  const rows = cells.map(spansOf)
  const countIn = (some: RippleNode[][]): number => some.reduce((sum, layer) => sum + layer.length, 0)
  const above = layers[start - 1]?.[0]
  if (above !== undefined) {
    rows[0] = note(`↑ ${countIn(layers.slice(0, start))} more above`)
    hits.push({ id: above.id, x: 0, y: 0, width: columns, height: 1 })
  }
  const below = layers[end]?.[0]
  if (below !== undefined) {
    rows[height - 1] = note(`↓ ${countIn(layers.slice(end))} more below`)
    hits.push({ id: below.id, x: 0, y: height - 1, width: columns, height: 1 })
  }
  return { rows, hits }
}

/**
 * The node a move from `selected` lands on: left and right along its layer,
 * up toward what uses it and down toward what it uses, to a linked node when
 * the next layer has one.
 */
export function stepInGraph(report: RippleReport, selected: string, move: Move): string {
  const layers = layersOf(report)
  const row = layers.findIndex(layer => layer.some(node => node.id === selected))
  const layer = layers[row]
  if (layer === undefined) return selected
  const column = layer.findIndex(node => node.id === selected)
  if (move === 'left' || move === 'right') {
    return layer[column + (move === 'left' ? -1 : 1)]?.id ?? selected
  }
  const next = layers[row + (move === 'up' ? -1 : 1)]
  if (next === undefined) return selected
  const linked = next.find(node =>
    report.edges.some(edge =>
      move === 'up' ? edge.from === node.id && edge.to === selected : edge.from === selected && edge.to === node.id,
    ),
  )
  return (linked ?? next[Math.min(column, next.length - 1)])?.id ?? selected
}
