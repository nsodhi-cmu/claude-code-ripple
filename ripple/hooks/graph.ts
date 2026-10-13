import { beyondRow, clipMiddle, markOf, reveal } from './draw'
import type { Drawing, Hit, Move, Paint, Pan, Room, Span, View } from './draw'
import { fileOf, isLinked, symbolIn } from './files'
import type { FileMap, MapFile } from './files'
import { rankOf } from './map'

// The graph view: a box a file, in layers along the flow of use, the files
// that use the change above it and the files it uses below, with the links
// between neighboring layers drawn in box characters. The layers are laid out
// once, in an order that never changes, and seen through a window that moves.

/**
 * How a graph wider than its room scrolls. `pinned`: each layer slides only
 * as far as it is long, so one that fits the room stays in view. `sheet`: the
 * layers lie on one sheet as wide as the longest, each box by what it is
 * linked to, and the sheet moves whole.
 */
export type GraphScroll = 'pinned' | 'sheet'

/** The most characters of a file's name a box shows. */
const NAME_CHARS = 32
/** What a box adds to its label: a space and a border on each side. */
const BOX_PADDING = 4
/** The room between two boxes of a layer. */
const BOX_GAP = 2
/** A box is a border, its label, and a border. */
const BOX_ROWS = 3
/** Between two layers: a row the links run along, and a row of arrowheads. */
const EDGE_ROWS = 2
const LAYER_ROWS = BOX_ROWS + EDGE_ROWS
/** The narrowest room the graph is drawn in: a box of the widest kind, less a little. */
export const GRAPH_COLUMNS = 40
/** The shortest: two layers and the links between them, over the row that counts what is out of view. */
export const GRAPH_ROWS = 2 * BOX_ROWS + EDGE_ROWS + 1
/** How much past the selected box a window that moves to it shows: the gap, and the start of the box beyond it. */
const MARGIN = BOX_GAP + 4
/** How much of a window stays in view when a click scrolls it sideways: about a box. */
const PAGE_OVERLAP = 16
/** How far one turn of the wheel scrolls. */
const WHEEL = { x: 8, y: 2 }
/** Where a file with no link to the layer nearer the change is sorted: after those that have one. */
const UNLINKED = Number.MAX_SAFE_INTEGER

/**
 * The map in layers, the farthest files that use the change first, each layer
 * ordered to sit by what it is linked to in the layer nearer the change, so
 * links cross less. Files that tie keep the order the map names them in.
 */
export function layersOf(map: FileMap): MapFile[][] {
  const byRank = new Map<number, MapFile[]>()
  for (const file of map.files) byRank.set(rankOf(file), [...(byRank.get(rankOf(file)) ?? []), file])
  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  const outward = [...ranks.filter(rank => rank >= 0), ...ranks.filter(rank => rank < 0).reverse()]

  for (const rank of outward) {
    const layer = byRank.get(rank) ?? []
    const nearer = rank === 0 ? [] : (byRank.get(rank < 0 ? rank + 1 : rank - 1) ?? [])
    const pullOf = (file: MapFile): number => {
      const places = nearer.flatMap((other, place) =>
        (rank < 0 ? isLinked(map, file, other) : isLinked(map, other, file)) ? [place] : [],
      )
      return places.length === 0 ? UNLINKED : places.reduce((sum, place) => sum + place, 0) / places.length
    }
    const pulls = new Map(layer.map(file => [file, pullOf(file)]))
    byRank.set(
      rank,
      [...layer].sort((a, b) => (pulls.get(a) ?? 0) - (pulls.get(b) ?? 0)),
    )
  }
  return ranks.map(rank => byRank.get(rank) ?? [])
}

/** What a box says of its file: its mark and its name. */
function nameOf(file: MapFile): string {
  return `${markOf(file).glyph} ${clipMiddle(file.name, NAME_CHARS)}`
}

/** What a box says after the name: how many of the map's symbols the file holds, when more than one. */
function countOf(file: MapFile): string {
  return file.symbols.length > 1 ? `  ${file.symbols.length}` : ''
}

/** A file's box: where it starts along its shelf, and how wide it is. */
type Box = { file: MapFile; x: number; width: number }

/**
 * One layer as it is laid out: its boxes, the columns they take side by
 * side, and the columns they are laid out across, which the window slides
 * over when they are more than the room's.
 */
type Shelf = { boxes: Box[]; width: number; across: number }

/** The whole map laid out for a room `columns` wide, whatever window it is seen through. */
type Layout = { shelves: Shelf[]; columns: number; rows: number }

const centerOf = (box: Box): number => box.x + Math.floor(box.width / 2)

/**
 * Seats a shelf's boxes across `columns`, each as near as it can be to the
 * middle of the boxes of `beside` it is linked to, so that links run short
 * and straight. The boxes are pushed apart where they would overlap, and the
 * shelf is then slid back toward where it wanted to be. With nothing beside
 * it to sit by, the shelf is centered.
 */
function seat(shelf: Shelf, columns: number, beside: Box[], isBeside: (box: Box, other: Box) => boolean): void {
  const wanted = shelf.boxes.map(box => {
    const linked = beside.filter(other => isBeside(box, other))
    if (linked.length === 0) return undefined
    return Math.round(linked.reduce((sum, other) => sum + centerOf(other), 0) / linked.length) - Math.floor(box.width / 2)
  })
  const hasWants = wanted.some(want => want !== undefined)
  let x = hasWants ? 0 : Math.floor((columns - shelf.width) / 2)
  shelf.boxes.forEach((box, index) => {
    box.x = Math.max(x, wanted[index] ?? x)
    x = box.x + box.width + BOX_GAP
  })
  let limit = columns
  for (const box of [...shelf.boxes].reverse()) {
    box.x = Math.max(0, Math.min(box.x, limit - box.width))
    limit = box.x - BOX_GAP
  }
  const offsets = shelf.boxes.flatMap((box, index) => (wanted[index] === undefined ? [] : [(wanted[index] ?? 0) - box.x]))
  const [first, last] = [shelf.boxes[0], shelf.boxes.at(-1)]
  if (offsets.length === 0 || first === undefined || last === undefined) return
  const mean = Math.round(offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length)
  const slide = Math.max(-first.x, Math.min(mean, columns - last.x - last.width))
  for (const box of shelf.boxes) box.x += slide
}

/**
 * Lays the map out: the changed files first, then each other shelf against
 * the one nearer them where the two are laid out across the same columns.
 * Pinned, that is the room's for every shelf that fits it, and a longer shelf
 * runs on alone from the left edge.
 */
function layoutOf(map: FileMap, room: Room, scroll: GraphScroll): Layout {
  const columns = Math.max(room.columns, GRAPH_COLUMNS)
  const layers = layersOf(map)
  const shelves: Shelf[] = layers.map(layer => {
    let x = 0
    const boxes = layer.map(file => {
      const box = { file, x, width: nameOf(file).length + countOf(file).length + BOX_PADDING }
      x += box.width + BOX_GAP
      return box
    })
    return { boxes, width: x - BOX_GAP, across: columns }
  })
  const widest = Math.max(columns, ...shelves.map(shelf => shelf.width))
  for (const shelf of shelves) shelf.across = scroll === 'sheet' ? widest : Math.max(columns, shelf.width)
  const middle = Math.max(
    0,
    layers.findIndex(layer => layer.some(file => file.role === 'changed')),
  )
  shelves.forEach((_, step) => {
    for (const index of step === 0 ? [middle] : [middle - step, middle + step]) {
      const shelf = shelves[index]
      if (shelf === undefined) continue
      const nearer = step === 0 ? undefined : shelves[index < middle ? index + 1 : index - 1]
      seat(shelf, shelf.across, nearer?.across === shelf.across ? nearer.boxes : [], (box, other) =>
        index < middle ? isLinked(map, box.file, other.file) : isLinked(map, other.file, box.file),
      )
    }
  })
  return { shelves, columns, rows: shelves.length * LAYER_ROWS - EDGE_ROWS }
}

/** How a layout is seen in a room: whether whole, through how many rows, and the farthest the window goes. */
type Sight = { isWhole: boolean; rows: number; most: Pan }

function sightOf(layout: Layout, room: Room): Sight {
  const x = Math.max(0, ...layout.shelves.map(shelf => shelf.across - layout.columns))
  const isWhole = x === 0 && layout.rows <= room.rows
  const rows = isWhole ? layout.rows : Math.max(1, Math.min(layout.rows, room.rows - 1))
  return { isWhole, rows, most: { x, y: layout.rows - rows } }
}

const within = (pan: Pan, most: Pan): Pan => ({
  x: Math.min(Math.max(Math.round(pan.x), 0), most.x),
  y: Math.min(Math.max(Math.round(pan.y), 0), most.y),
})

/** How far a shelf has slid under a window at `x`: with it, as far as the end of what the shelf is laid out across. */
const slideOf = (layout: Layout, shelf: Shelf, x: number): number => Math.min(x, shelf.across - layout.columns)

/** Where the selected file's box is: its shelf's place among the shelves, the shelf, and the box. */
function placeOf(layout: Layout, picked: MapFile | undefined): { row: number; shelf: Shelf; box: Box } | undefined {
  for (const [row, shelf] of layout.shelves.entries()) {
    const box = shelf.boxes.find(one => one.file === picked)
    if (box !== undefined) return { row, shelf, box }
  }
  return undefined
}

type Frame = { corners: string; across: string; down: string; exit: string }

const FRAMES = {
  plain: { corners: '┌┐└┘', across: '─', down: '│', exit: '┬' },
  selected: { corners: '╔╗╚╝', across: '═', down: '║', exit: '╤' },
} as const satisfies Record<string, Frame>

/**
 * A box where the window shows it: in the window's own cells, which it may
 * lie partly or wholly outside. One linked to the selected file is lit, as
 * the links that touch that file are.
 */
type Seen = Box & { y: number; isSelected: boolean; isLit: boolean }

function borderOf(box: Seen): Paint {
  if (box.isSelected || box.isLit) return 'accent'
  const { paint } = markOf(box.file)
  return paint === 'plain' ? 'dim' : paint
}

type Cell = { char: string; paint: Paint; isBold?: true; isInverse?: true }

/** The cells a window is painted on, and the one way they are written: what falls outside them is not. */
type Canvas = { cells: Cell[][]; put: (x: number, y: number, text: string, style: Omit<Cell, 'char'>) => void }

function canvasOf(columns: number, rows: number): Canvas {
  const cells: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({ char: ' ', paint: 'plain' as Paint })),
  )
  const put: Canvas['put'] = (x, y, text, style) => {
    ;[...text].forEach((char, index) => {
      const row = cells[y]
      if (row !== undefined && x + index >= 0 && x + index < columns) row[x + index] = { char, ...style }
    })
  }
  return { cells, put }
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

/**
 * Paints a shelf's boxes, and answers where a click selects which file, over
 * as much of its box as the window shows: the symbol selected in it, or its
 * first. A box the window's edge cuts ends there in an ellipsis.
 */
function paintBoxes(canvas: Canvas, boxes: Seen[], selected: string | null, columns: number): Hit[] {
  const hits: Hit[] = []
  for (const box of boxes) {
    const frame = box.isSelected ? FRAMES.selected : FRAMES.plain
    const border = { paint: borderOf(box) }
    const [topLeft = '', topRight = '', bottomLeft = '', bottomRight = ''] = frame.corners
    const bar = frame.across.repeat(box.width - 2)
    canvas.put(box.x, box.y, `${topLeft}${bar}${topRight}`, border)
    canvas.put(box.x, box.y + 1, frame.down, border)
    canvas.put(box.x + box.width - 1, box.y + 1, frame.down, border)
    canvas.put(box.x, box.y + 2, `${bottomLeft}${bar}${bottomRight}`, border)
    canvas.put(box.x + 2, box.y + 1, nameOf(box.file), {
      paint: markOf(box.file).paint,
      ...(box.isSelected ? { isBold: true as const, isInverse: true as const } : {}),
    })
    canvas.put(box.x + 2 + nameOf(box.file).length, box.y + 1, countOf(box.file), { paint: 'dim' })
    if (box.x < 0 && box.x + box.width > 0) canvas.put(0, box.y + 1, '…', { paint: 'dim' })
    if (box.x < columns && box.x + box.width > columns) canvas.put(columns - 1, box.y + 1, '…', { paint: 'dim' })
    const symbol = symbolIn(box.file, selected)
    const [x, y] = [Math.max(box.x, 0), Math.max(box.y, 0)]
    const width = Math.min(box.x + box.width, columns) - x
    const height = Math.min(box.y + BOX_ROWS, canvas.cells.length) - y
    if (symbol !== undefined && width > 0 && height > 0) hits.push({ id: symbol.id, x, y, width, height })
  }
  return hits
}

/** Which ways a link leaves a cell of the row the links run along; a cell several links share shows all of theirs. */
const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8

const JUNCTIONS: Record<number, string> = {
  [UP | DOWN]: '│',
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

/**
 * Paints the links between one shelf and the one under it. A link leaves the
 * upper box straight down where that box reaches over the lower one, else
 * from its middle, and what touches the selected file is lit over what does
 * not. A link to a box out of the window runs off the window's edge.
 */
function paintEdges(canvas: Canvas, map: FileMap, upper: Seen[], lower: Seen[], columns: number): void {
  const runY = (upper[0]?.y ?? 0) + BOX_ROWS
  const run = new Map<number, { ways: number; isLit: boolean }>()
  const lit = new Set<string>()
  const mark = (x: number, way: number, isLit: boolean): void => {
    if (x < 0 || x >= columns) return
    const at = run.get(x) ?? { ways: 0, isLit: false }
    run.set(x, { ways: at.ways | way, isLit: at.isLit || isLit })
  }
  const paintOnce = (x: number, y: number, char: string, isLit: boolean, unlit: Paint): void => {
    if (lit.has(`${x},${y}`)) return
    if (isLit) lit.add(`${x},${y}`)
    canvas.put(x, y, char, { paint: isLit ? 'accent' : unlit })
  }
  for (const from of upper) {
    for (const to of lower.filter(box => isLinked(map, from.file, box.file))) {
      const isLit = from.isSelected || to.isSelected
      const into = centerOf(to)
      const out = into > from.x && into < from.x + from.width - 1 ? into : centerOf(from)
      const frame = from.isSelected ? FRAMES.selected : FRAMES.plain
      paintOnce(out, runY - 1, frame.exit, isLit, borderOf(from))
      paintOnce(into, runY + 1, '▼', isLit, 'dim')
      mark(out, UP, isLit)
      mark(into, DOWN, isLit)
      const [start, end] = [Math.min(out, into), Math.max(out, into)]
      for (let x = Math.max(start, 0); x <= Math.min(end, columns - 1); x += 1) {
        if (x > start) mark(x, LEFT, isLit)
        if (x < end) mark(x, RIGHT, isLit)
      }
    }
  }
  for (const [x, at] of run) canvas.put(x, runY, JUNCTIONS[at.ways] ?? ' ', { paint: at.isLit ? 'accent' : 'dim' })
}

/**
 * Draws a layout through a window at `pan`. Every shelf slides under the
 * window together, each as far as its own end. A map larger than the room has
 * a row under it that counts the files out of view.
 */
function draw(layout: Layout, map: FileMap, selected: string | null, room: Room, pan: Pan): Drawing {
  if (layout.shelves.length === 0) return { rows: [], hits: [] }
  const sight = sightOf(layout, room)
  const at = within(pan, sight.most)
  const picked = fileOf(map, selected)
  const canvas = canvasOf(layout.columns, sight.rows)

  const seen: Seen[][] = layout.shelves.map((shelf, row) =>
    shelf.boxes.map(box => ({
      ...box,
      x: box.x - slideOf(layout, shelf, at.x),
      y: row * LAYER_ROWS - at.y,
      isSelected: box.file === picked,
      isLit: picked !== undefined && (isLinked(map, box.file, picked) || isLinked(map, picked, box.file)),
    })),
  )
  const hits = seen.flatMap(boxes => paintBoxes(canvas, boxes, selected, layout.columns))
  seen.slice(0, -1).forEach((upper, row) => paintEdges(canvas, map, upper, seen[row + 1] ?? [], layout.columns))

  const rows = canvas.cells.map(spansOf)
  if (sight.isWhole) return { rows, hits }
  const boxes = seen.flat()
  const beyond = beyondRow(
    {
      left: boxes.filter(box => box.x < 0).length,
      right: boxes.filter(box => box.x + box.width > layout.columns).length,
      above: boxes.filter(box => box.y < 0).length,
      below: boxes.filter(box => box.y + BOX_ROWS > sight.rows).length,
    },
    layout.columns,
    { x: Math.max(1, layout.columns - PAGE_OVERLAP), y: LAYER_ROWS },
    rows.length,
  )
  return { rows: [...rows, beyond.row], hits: [...hits, ...beyond.hits] }
}

/**
 * Where the window stands to show the selected file. One that already shows
 * its whole box stays where it is; one that does not moves just far enough
 * to show the box, the links above and below it, and the start of the boxes
 * beside it.
 */
function show(layout: Layout, map: FileMap, selected: string | null, room: Room, from: Pan): Pan {
  const sight = sightOf(layout, room)
  const at = within(from, sight.most)
  const place = placeOf(layout, fileOf(map, selected))
  if (place === undefined) return at
  const { row, shelf, box } = place
  const slide = slideOf(layout, shelf, at.x)
  const shown = reveal(slide, box.x, box.x + box.width, layout.columns, shelf.across, MARGIN)
  return within(
    {
      x: shown === slide ? at.x : shown,
      y: reveal(at.y, row * LAYER_ROWS, row * LAYER_ROWS + BOX_ROWS, sight.rows, layout.rows, EDGE_ROWS),
    },
    sight.most,
  )
}

/**
 * Where the window stands after it is scrolled from `from`: by cells, or by
 * turns of the wheel, which go the way the map has more rooms' worth out of
 * view, along it or down it.
 */
function scroll(layout: Layout, room: Room, from: Pan, by: Pan | number): Pan {
  const { most, rows } = sightOf(layout, room)
  const at = within(from, most)
  const isDown = most.y * layout.columns > most.x * rows
  const step = typeof by !== 'number' ? by : isDown ? { x: 0, y: by * WHEEL.y } : { x: by * WHEEL.x, y: 0 }
  return within({ x: at.x + step.x, y: at.y + step.y }, most)
}

/**
 * The symbol a move from the selected file lands on, the first of the file
 * it reaches: left and right along its layer, up toward what uses it and down
 * toward what it uses, to the linked file nearest it in the window, or with
 * none linked, the nearest.
 */
function step(layout: Layout, map: FileMap, selected: string | null, move: Move, room: Room, pan: Pan): string | null {
  const place = placeOf(layout, fileOf(map, selected))
  if (place === undefined) return selected
  const { row, shelf, box } = place
  const at = within(pan, sightOf(layout, room).most)
  let to: Box | undefined
  if (move === 'left' || move === 'right') {
    to = shelf.boxes[shelf.boxes.indexOf(box) + (move === 'left' ? -1 : 1)]
  } else {
    const next = layout.shelves[row + (move === 'up' ? -1 : 1)]
    const linked = (next?.boxes ?? []).filter(other =>
      move === 'up' ? isLinked(map, other.file, box.file) : isLinked(map, box.file, other.file),
    )
    const from = centerOf(box) - slideOf(layout, shelf, at.x)
    const farOf = (other: Box): number =>
      Math.abs(centerOf(other) - (next === undefined ? 0 : slideOf(layout, next, at.x)) - from)
    to = [...(linked.length > 0 ? linked : (next?.boxes ?? []))].sort((a, b) => farOf(a) - farOf(b))[0]
  }
  return (to === undefined ? undefined : symbolIn(to.file, null)?.id) ?? selected
}

/** The graph view, scrolling as `how` says. */
export function graphView(how: GraphScroll): View {
  return {
    draw: (map, selected, room, pan) => draw(layoutOf(map, room, how), map, selected, room, pan),
    show: (map, selected, room, from) => show(layoutOf(map, room, how), map, selected, room, from),
    scroll: (map, room, from, by) => scroll(layoutOf(map, room, how), room, from, by),
    step: (map, selected, move, room, pan) => step(layoutOf(map, room, how), map, selected, move, room, pan),
  }
}
