import type { RippleNode, RippleReport } from '../types'
import { clip, locOf, markOf, note, windowOf } from './draw'
import type { Drawing, Hit, Move, Room, Span } from './draw'

// The tree view: one row a node, each changed symbol with its dependents
// hanging under it and then what it uses. Nothing here touches `$`.

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
 * step nearer the change, that it is linked to; one linked to none is a root.
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
  for (const node of report.nodes) if (!placed.has(node.id)) walk(node, null, '', '')
  return rows
}

/** `signature changed`, `breaks · untested`: what a row says after where the node is. */
function wordsOf(node: RippleNode): string {
  const words: string[] = []
  if (node.role === 'changed') {
    words.push(node.change === 'signature' || node.change === 'behavior' ? `${node.change} changed` : (node.change ?? 'changed'))
  }
  if (node.risk !== 'ok') words.push(node.risk)
  if (!node.tested && node.role !== 'dependency') words.push('untested')
  return words.join(' · ')
}

/** Draws the map as a tree in `room`, around the selected node. */
export function drawTree(report: RippleReport, selected: string | null, room: Room): Drawing {
  const tree = treeOf(report)
  const isCut = tree.length > room.rows
  const at = Math.max(
    0,
    tree.findIndex(row => row.node.id === selected),
  )
  const [start, end] = isCut ? windowOf(tree.length, Math.max(1, room.rows - 2), at, at) : [0, tree.length]
  const headColumns = Math.max(0, ...tree.map(row => row.lead.length + 2 + Math.min(row.node.name.length, NAME_CHARS)))
  const whereColumns = Math.min(WHERE_CHARS, Math.max(0, ...tree.map(row => locOf(row.node).length)))

  const rows: Span[][] = []
  const hits: Hit[] = []
  const above = tree[start - 1]
  if (isCut) {
    if (above !== undefined) hits.push({ id: above.node.id, x: 0, y: 0, width: room.columns, height: 1 })
    rows.push(note(above === undefined ? '' : `↑ ${start} more above`))
  }
  for (const row of tree.slice(start, end)) {
    const { node } = row
    const mark = markOf(node)
    const name = clip(node.name, NAME_CHARS)
    const isSelected = node.id === selected
    const words = wordsOf(node)
    const spans: Span[] = [
      { text: row.lead, paint: 'dim' },
      {
        text: `${mark.glyph} ${name}`,
        paint: mark.paint,
        ...(isSelected ? { isBold: true as const, isInverse: true as const } : {}),
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
  if (isCut) {
    if (below !== undefined) hits.push({ id: below.node.id, x: 0, y: rows.length, width: room.columns, height: 1 })
    rows.push(note(below === undefined ? '' : `↓ ${tree.length - end} more below`))
  }
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
