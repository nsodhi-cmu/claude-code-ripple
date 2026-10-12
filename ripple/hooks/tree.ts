import type { RippleNode, RippleReport } from '../types'
import { locOf, markOf, note, windowOf, wordsOf } from './draw'
import type { Drawing, Hit, Move, Room, Span } from './draw'
import { clip } from './map'

// The tree view: one row a node, each changed symbol with its dependents
// hanging under it and then what it uses.

/** The most characters of a name a row shows. */
const NAME_CHARS = 32
/** How far the words after a location are pushed right to line up; a longer location pushes its own. */
const WHERE_CHARS = 28

export type TreeRow = {
  node: RippleNode
  /** The guides before the mark: `├─ `, `│  └─ `. */
  lead: string
  /** The id of the row this one hangs under; null for a root. */
  parent: string | null
}

/**
 * The tree's rows, top to bottom. A node hangs under the first node, one
 * step nearer the change, that it is linked to; one linked to none is a root,
 * after the changed symbols and nearest the change first.
 */
export function treeOf(report: RippleReport): TreeRow[] {
  const placed = new Set<string>()
  const rows: TreeRow[] = []
  const childrenOf = (parent: RippleNode): RippleNode[] =>
    report.nodes.filter(node => {
      if (placed.has(node.id) || node.role === 'changed' || node.depth !== parent.depth + 1) return false
      if (parent.role !== 'changed' && parent.role !== node.role) return false
      return report.edges.some(edge =>
        node.role === 'dependent'
          ? edge.from === node.id && edge.to === parent.id
          : edge.from === parent.id && edge.to === node.id,
      )
    })
  const walk = (node: RippleNode, parent: string | null, lead: string, rest: string): void => {
    placed.add(node.id)
    rows.push({ node, lead, parent })
    const linked = childrenOf(node)
    const children = [
      ...linked.filter(child => child.role === 'dependent'),
      ...linked.filter(child => child.role === 'dependency'),
    ]
    for (const child of children) placed.add(child.id)
    children.forEach((child, index) => {
      const isLast = index === children.length - 1
      walk(child, node.id, rest + (isLast ? '└─ ' : '├─ '), rest + (isLast ? '   ' : '│  '))
    })
  }
  for (const node of report.nodes.filter(one => one.role === 'changed')) walk(node, null, '', '')
  for (const node of [...report.nodes].sort((a, b) => a.depth - b.depth)) {
    if (!placed.has(node.id)) walk(node, null, '', '')
  }
  return rows
}

/**
 * The run of rows that fits down `rows` around row `at`: as many as do,
 * leaving a row for each line that counts a cut.
 */
function rowsIn(total: number, at: number, rows: number): [start: number, end: number] {
  for (let count = Math.min(total, rows); count > 1; count -= 1) {
    const [start, end] = windowOf(total, count, at, at)
    if (count + (start > 0 ? 1 : 0) + (end < total ? 1 : 0) <= rows) return [start, end]
  }
  return windowOf(total, 1, at, at)
}

/** Draws the map as a tree in `room`, around the selected node. */
export function drawTree(report: RippleReport, selected: string | null, room: Room): Drawing {
  const tree = treeOf(report)
  const at = Math.max(
    0,
    tree.findIndex(row => row.node.id === selected),
  )
  const [start, end] = rowsIn(tree.length, at, room.rows)
  const headColumns = Math.max(0, ...tree.map(row => row.lead.length + 2 + Math.min(row.node.name.length, NAME_CHARS)))
  const whereColumns = Math.min(WHERE_CHARS, Math.max(0, ...tree.map(row => locOf(row.node).length)))

  const rows: Span[][] = []
  const hits: Hit[] = []
  const cut = (text: string, into: TreeRow): void => {
    hits.push({ id: into.node.id, x: 0, y: rows.length, width: room.columns, height: 1 })
    rows.push(note(text))
  }
  const above = tree[start - 1]
  if (above !== undefined) cut(`↑ ${start} more above`, above)
  for (const row of tree.slice(start, end)) {
    const { node } = row
    const mark = markOf(node)
    const name = clip(node.name, NAME_CHARS)
    const words = wordsOf(node).join(' · ')
    const spans: Span[] = [
      { text: row.lead, paint: 'dim' },
      {
        text: `${mark.glyph} ${name}`,
        paint: mark.paint,
        ...(node.id === selected ? { isBold: true as const, isInverse: true as const } : {}),
      },
      { text: `${' '.repeat(headColumns - row.lead.length - 2 - name.length + 2)}${locOf(node)}`, paint: 'dim' },
    ]
    if (words !== '') {
      const gap = ' '.repeat(Math.max(0, whereColumns - locOf(node).length) + 2)
      spans.push({ text: `${gap}${words}`, paint: mark.paint === 'plain' ? 'dim' : mark.paint })
    }
    hits.push({ id: node.id, x: 0, y: rows.length, width: room.columns, height: 1 })
    rows.push(spans)
  }
  const below = tree[end]
  if (below !== undefined) cut(`↓ ${tree.length - end} more below`, below)
  return { rows, hits }
}

/**
 * The node a move from `selected` lands on: up and down the rows, left to
 * the node a row hangs under, right to the first that hangs under it.
 */
export function stepInTree(report: RippleReport, selected: string, move: Move): string {
  const tree = treeOf(report)
  const at = tree.findIndex(row => row.node.id === selected)
  const row = tree[at]
  if (row === undefined) return selected
  if (move === 'up') return tree[at - 1]?.node.id ?? selected
  if (move === 'down') return tree[at + 1]?.node.id ?? selected
  if (move === 'left') return row.parent ?? selected
  return tree.find(other => other.parent === selected)?.node.id ?? selected
}
