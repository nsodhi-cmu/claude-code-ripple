import { beyondRow, clipStart, cutRow, markOf, reveal } from './draw'
import type { Drawing, Hit, Move, Pan, Room, Span, View } from './draw'
import { fileOf, isLinked, symbolIn } from './files'
import type { FileMap, MapFile } from './files'

// The tree view: a row a file, each changed file with the files that use it
// hanging under it and then the files it uses, and after each path the
// symbols the map has in the file.

/** How far the symbols after a path are pushed right to line up; a longer path pushes its own. */
const PATH_COLUMNS = 44
/** The room between a path, or the column the paths end at, and the symbols after it. */
const NAMES_GAP = 2
/** How many rows past the selected one a window that moves to it shows. */
const MARGIN = 1
/** How many rows one turn of the wheel scrolls. */
const WHEEL = 2

export type TreeRow = {
  file: MapFile
  /** The guides before the mark: `├─ `, `│  └─ `. */
  lead: string
  /** The file this one hangs under; null for a root. */
  parent: MapFile | null
}

/**
 * The tree's rows, top to bottom. A file hangs under the first file, one
 * step nearer the change, that it is linked to; one linked to none is a root,
 * after the changed files and nearest the change first.
 */
export function treeOf(map: FileMap): TreeRow[] {
  const placed = new Set<MapFile>()
  const rows: TreeRow[] = []
  const childrenOf = (parent: MapFile): MapFile[] =>
    map.files.filter(file => {
      if (placed.has(file) || file.role === 'changed' || file.depth !== parent.depth + 1) return false
      if (parent.role !== 'changed' && parent.role !== file.role) return false
      return file.role === 'dependent' ? isLinked(map, file, parent) : isLinked(map, parent, file)
    })
  const walk = (file: MapFile, parent: MapFile | null, lead: string, rest: string): void => {
    placed.add(file)
    rows.push({ file, lead, parent })
    const linked = childrenOf(file)
    const children = [
      ...linked.filter(child => child.role === 'dependent'),
      ...linked.filter(child => child.role === 'dependency'),
    ]
    for (const child of children) placed.add(child)
    children.forEach((child, index) => {
      const isLast = index === children.length - 1
      walk(child, file, rest + (isLast ? '└─ ' : '├─ '), rest + (isLast ? '   ' : '│  '))
    })
  }
  for (const file of map.files.filter(one => one.role === 'changed')) walk(file, null, '', '')
  for (const file of [...map.files].sort((a, b) => a.depth - b.depth)) {
    if (!placed.has(file)) walk(file, null, '', '')
  }
  return rows
}

/** How many of the tree's rows a room shows: all of them, or what is left over the row that counts the rest. */
function shownIn(total: number, room: Room): number {
  return total <= room.rows ? total : Math.max(1, room.rows - 1)
}

const startOf = (total: number, shown: number, pan: Pan): number =>
  Math.min(Math.max(Math.round(pan.y), 0), total - shown)

/**
 * Draws the map as a tree through a window at `pan`. A path too long for
 * the room loses its start, so the file's own name stays; a row that still
 * runs past the room ends in an ellipsis; and a tree taller than the room
 * has a row under it that counts the files out of view.
 */
function draw(map: FileMap, selected: string | null, room: Room, pan: Pan): Drawing {
  const tree = treeOf(map)
  const picked = fileOf(map, selected)
  const shown = shownIn(tree.length, room)
  const start = startOf(tree.length, shown, pan)
  const pathOf = (row: TreeRow): string => clipStart(row.file.path, Math.max(1, room.columns - row.lead.length - 2))
  const headOf = (row: TreeRow): number => row.lead.length + 2 + pathOf(row).length
  const pathColumns = Math.min(PATH_COLUMNS, Math.max(0, ...tree.map(headOf)))

  const rows: Span[][] = []
  const hits: Hit[] = []
  for (const row of tree.slice(start, start + shown)) {
    const { file } = row
    const mark = markOf(file)
    const path = pathOf(row)
    const folder = path.slice(0, path.lastIndexOf('/') + 1)
    const symbol = symbolIn(file, selected)
    const spans: Span[] = [
      { text: row.lead, paint: 'dim' },
      { text: `${mark.glyph} `, paint: mark.paint },
      { text: folder, paint: 'dim' },
      {
        text: path.slice(folder.length),
        paint: mark.paint,
        ...(file === picked ? { isBold: true as const, isInverse: true as const } : {}),
      },
    ]
    if (headOf(row) + NAMES_GAP < room.columns) {
      const gap = ' '.repeat(Math.max(0, pathColumns - headOf(row)) + NAMES_GAP)
      spans.push({ text: `${gap}${file.symbols.map(one => one.name).join(', ')}`, paint: 'dim' })
    }
    if (symbol !== undefined) hits.push({ id: symbol.id, x: 0, y: rows.length, width: room.columns, height: 1 })
    rows.push(cutRow(spans, room.columns))
  }
  if (shown === tree.length) return { rows, hits }
  const beyond = beyondRow(
    { left: 0, right: 0, above: start, below: tree.length - start - shown },
    room.columns,
    { x: 0, y: shown },
    rows.length,
  )
  return { rows: [...rows, beyond.row], hits: [...hits, ...beyond.hits] }
}

/** Where the window stands to show the selected file's row: where it is when it shows the row, else just far enough to show it and the row past it. */
function show(map: FileMap, selected: string | null, room: Room, from: Pan): Pan {
  const tree = treeOf(map)
  const picked = fileOf(map, selected)
  const shown = shownIn(tree.length, room)
  const at = Math.max(
    0,
    tree.findIndex(row => row.file === picked),
  )
  const margin = shown > 2 * MARGIN ? MARGIN : 0
  return { x: 0, y: reveal(from.y, at, at + 1, shown, tree.length, margin) }
}

/** Where the window stands after it is scrolled from `from`: by rows, or by turns of the wheel. */
function scroll(map: FileMap, room: Room, from: Pan, by: Pan | number): Pan {
  const total = treeOf(map).length
  const shown = shownIn(total, room)
  const rows = typeof by === 'number' ? by * WHEEL : by.y
  return { x: 0, y: startOf(total, shown, { x: 0, y: startOf(total, shown, from) + rows }) }
}

/**
 * The symbol a move from the selected file lands on, the first of the file
 * it reaches: up and down the rows, left to the file a row hangs under,
 * right to the first that hangs under it.
 */
function step(map: FileMap, selected: string | null, move: Move): string | null {
  const tree = treeOf(map)
  const picked = fileOf(map, selected)
  const at = tree.findIndex(row => row.file === picked)
  const row = tree[at]
  if (row === undefined) return selected
  const to =
    move === 'up'
      ? tree[at - 1]?.file
      : move === 'down'
        ? tree[at + 1]?.file
        : move === 'left'
          ? (row.parent ?? undefined)
          : tree.find(other => other.parent === row.file)?.file
  return (to === undefined ? undefined : symbolIn(to, null)?.id) ?? selected
}

export const treeView: View = { draw, show, scroll, step }
