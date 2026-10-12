import type { RippleMode, RippleNode, RippleReport } from '../types'
import { locOf, markOf, wordsOf } from './draw'
import type { Drawing, Move, Paint, Room } from './draw'
import { GRAPH_COLUMNS, GRAPH_ROWS, drawGraph, stepInGraph } from './graph'
import { flagged, neighborsOf } from './map'
import { drawTree, stepInTree } from './tree'

// What the person is looking at: which view, which node is selected in it,
// and how the pane's rows are shared out around it.

/** The keys that move the selection: the arrows once the map has been clicked, and the letters under them. */
export const MOVES: Readonly<Record<string, Move>> = {
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
  h: 'left',
  l: 'right',
  k: 'up',
  j: 'down',
}

/** The selected node: the one `selected` names while the map still holds it, else where a reader starts. */
export function selectedOf(report: RippleReport, selected: string | null): RippleNode | undefined {
  return (
    report.nodes.find(node => node.id === selected) ??
    flagged(report)[0] ??
    report.nodes.find(node => node.role === 'changed') ??
    report.nodes[0]
  )
}

/** The mode a room is drawn in: the one asked for, but the tree where the graph has no room. */
export function modeIn(mode: RippleMode, room: Room): RippleMode {
  return room.columns < GRAPH_COLUMNS || room.rows < GRAPH_ROWS ? 'tree' : mode
}

export function drawView(report: RippleReport, mode: RippleMode, selected: string | null, room: Room): Drawing {
  const at = selectedOf(report, selected)?.id ?? null
  return modeIn(mode, room) === 'tree' ? drawTree(report, at, room) : drawGraph(report, at, room)
}

/** The id selected after one step of the selection. */
export function stepped(report: RippleReport, mode: RippleMode, selected: string | null, move: Move): string | null {
  const from = selectedOf(report, selected)
  if (from === undefined) return selected
  return (mode === 'tree' ? stepInTree : stepInGraph)(report, from.id, move)
}

/** The id of the flagged node after the selected one, the first again after the last; the selection kept when nothing is flagged. */
export function nextFlagged(report: RippleReport, selected: string | null): string | null {
  const all = flagged(report)
  const from = selectedOf(report, selected)?.id
  return all[(all.findIndex(node => node.id === from) + 1) % Math.max(all.length, 1)]?.id ?? selected
}

/** What the pane says about the selected node, under the map. */
export type Detail = {
  name: string
  /** `function · untested`: what it is, and what else a reader should know of it. */
  facts: string
  where: string
  /** Why it is flagged, or what changed about it. */
  verdict?: { text: string; paint: Paint }
  /** `uses formatPrice · used by CheckoutPage, InvoicePage` */
  links: string
}

export function detailOf(report: RippleReport, node: RippleNode): Detail {
  const { uses, usedBy } = neighborsOf(report, node.id)
  const names = (nodes: RippleNode[]): string => nodes.map(other => other.name).join(', ')
  const links = [
    ...(uses.length > 0 ? [`uses ${names(uses)}`] : []),
    ...(usedBy.length > 0 ? [`used by ${names(usedBy)}`] : []),
  ]
  const words = wordsOf(node)
  const verdict = words.filter(word => word !== 'untested').join(' · ')
  return {
    name: node.name,
    facts: [node.kind, ...words.filter(word => word === 'untested')].join(' · '),
    where: locOf(node),
    ...(verdict === ''
      ? {}
      : { verdict: { text: node.reason === undefined ? verdict : `${verdict}: ${node.reason}`, paint: markOf(node).paint } }),
    links: links.join(' · '),
  }
}

/** From this many rows a pane has room for everything said around the map. */
const ROOMY_ROWS = 28
/** The fewest rows the map is drawn in, however short the pane. */
const MIN_MAP_ROWS = 5
/** The blank rows of a roomy pane: over the map, under it, and over the keys. */
const GAPS = 3
/** The room between two things laid side by side in a row that wraps. */
const FLOW_GAP = 2
/** What a plain Button adds to its label: its hotkey, a colon, and a space. */
const KEY_CHARS = 3

/** How the rows under the map are held for the selected node: its name, its verdict, and what it is linked to. */
export type DetailRows = { verdict: number; links: number }

/** How a pane's rows are shared out. */
export type Plan = {
  /** Whether the pane keeps only the header, the map, a short detail, and the keys. */
  isCompact: boolean
  mapRows: number
  detail: DetailRows
}

/** How many rows `text` takes when it is wrapped at spaces across `columns`. */
export function wrappedRows(text: string, columns: number): number {
  if (text === '') return 0
  let rows = 1
  let used = 0
  for (const word of text.split(' ')) {
    const needed = used === 0 ? word.length : used + 1 + word.length
    if (needed <= columns) {
      used = needed
    } else {
      rows += used === 0 ? Math.ceil(word.length / columns) - 1 : Math.ceil(word.length / columns)
      used = word.length % columns || Math.min(word.length, columns)
    }
  }
  return rows
}

/** How many rows things of these widths take, laid side by side and wrapped across `columns`. */
export function flowRows(widths: readonly number[], columns: number): number {
  let rows = widths.length === 0 ? 0 : 1
  let used = 0
  for (const width of widths) {
    if (used > 0 && used + FLOW_GAP + width > columns) {
      rows += 1
      used = width
    } else {
      used += (used > 0 ? FLOW_GAP : 0) + width
    }
  }
  return rows
}

/**
 * Shares out a pane's rows. A roomy pane says everything around the map; a
 * short one keeps the header, the notice, two lines on the selected node, and
 * the keys. The rows held for the selected node do not depend on which node
 * it is, so the map keeps its size as the selection moves.
 */
export function planOf(
  room: Room,
  said: { summary: string; hasNotice: boolean; legend: readonly string[]; keys: readonly string[] },
): Plan {
  const isCompact = room.rows < ROOMY_ROWS
  const detail: DetailRows = isCompact ? { verdict: 1, links: 0 } : { verdict: 2, links: 1 }
  const keys = flowRows(
    said.keys.map(label => label.length + KEY_CHARS),
    room.columns,
  )
  const under = 1 + detail.verdict + detail.links + keys
  const over = isCompact
    ? 1
    : 2 +
      wrappedRows(said.summary, room.columns) +
      flowRows(
        said.legend.map(label => label.length),
        room.columns,
      ) +
      GAPS
  return {
    isCompact,
    mapRows: Math.max(MIN_MAP_ROWS, room.rows - over - (said.hasNotice ? 1 : 0) - under),
    detail,
  }
}
