import type { RippleMode, RippleNode, RippleReport } from '../types'
import type { Move, Room } from './draw'
import { GRAPH_COLUMNS, GRAPH_ROWS } from './graph'
import { flagged, neighborsOf } from './map'

// What the person is looking at: which view of the map, which symbol is
// selected, and how the pane's rows are shared out around them.

/** The keys that move the selection from file to file: the arrows once the map has been clicked, and the letters under them. */
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

/** The keys that move the selection up and down the selected file's symbols. */
export const LIST_MOVES: Readonly<Record<string, Move>> = { u: 'up', d: 'down' }

/** The selected symbol: the one `selected` names while the map still holds it, else where a reader starts. */
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

/** The id of the flagged symbol after the selected one, the first again after the last; the selection kept when nothing is flagged. */
export function nextFlagged(report: RippleReport, selected: string | null): string | null {
  const all = flagged(report)
  const from = selectedOf(report, selected)?.id
  return all[(all.findIndex(node => node.id === from) + 1) % Math.max(all.length, 1)]?.id ?? selected
}

/** `function · uses formatPrice · used by CheckoutPage, InvoicePage`: what the selected symbol is, and its links. */
export function factsOf(report: RippleReport, node: RippleNode): string {
  const { uses, usedBy } = neighborsOf(report, node.id)
  const names = (nodes: RippleNode[]): string => nodes.map(other => other.name).join(', ')
  return [
    node.kind,
    ...(uses.length > 0 ? [`uses ${names(uses)}`] : []),
    ...(usedBy.length > 0 ? [`used by ${names(usedBy)}`] : []),
  ].join(' · ')
}

/**
 * A pane says everything around the map once that leaves the map this many
 * rows, when the map needs so many: five layers of the graph, which is as
 * deep as a mapper goes, and the row that counts what is out of view.
 */
const ROOMY_MAP_ROWS = 24
/** The fewest rows the map is drawn in, however short the pane. */
const MIN_MAP_ROWS = 4
/** The most symbols the list shows at once, in a roomy pane and in a short one. */
const LIST_ROWS = { roomy: 5, compact: 2 }
/**
 * The rows under the list for the selected symbol. A roomy pane says what it
 * is and gives the mapper's reason two rows; a short one gives the reason one.
 */
const DETAIL_ROWS = { roomy: 3, compact: 1 }
/** The room between two things laid side by side in a row that wraps. */
const FLOW_GAP = 2
/** What a plain Button adds to its label: its hotkey, a colon, and a space. */
const KEY_CHARS = 3

/** How a pane's rows are shared out. */
export type Plan = {
  /** Whether the pane keeps only the header, the notice, the map, the list, the mapper's reason, and the keys. */
  isCompact: boolean
  /** The rows over the map. */
  mapTop: number
  mapRows: number
  listRows: number
  /** The rows under the list for the selected symbol. */
  detailRows: number
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
 * Shares out a pane's rows. A pane says everything around the map where the
 * map still gets the rows it needs to be drawn whole, or `ROOMY_MAP_ROWS` of
 * them; else it keeps the header, the notice, the list, a row for the
 * mapper's reason, and the keys, and the map takes the rest. The list is as
 * long as the map's fullest file needs, up to a limit. Nothing here depends
 * on what is selected, so the map, the list, and the keys keep their places
 * as the selection moves.
 */
export function planOf(
  room: Room,
  said: {
    summary: string
    hasNotice: boolean
    legend: readonly string[]
    keys: readonly string[]
    /** The most symbols any file of the map holds. */
    symbols: number
    /** The rows the map takes drawn whole. */
    mapNeeds: number
  },
): Plan {
  const keys = flowRows(
    said.keys.map(label => label.length + KEY_CHARS),
    room.columns,
  )
  const share = (isCompact: boolean): Plan => {
    const listRows = Math.max(1, Math.min(said.symbols, isCompact ? LIST_ROWS.compact : LIST_ROWS.roomy))
    const detailRows = isCompact ? DETAIL_ROWS.compact : DETAIL_ROWS.roomy
    const over = isCompact
      ? 1
      : 2 +
        wrappedRows(said.summary, room.columns) +
        flowRows(
          said.legend.map(label => label.length),
          room.columns,
        ) +
        1
    const mapTop = over + (said.hasNotice ? 1 : 0)
    const under = (isCompact ? 0 : 1) + 1 + listRows + detailRows + (isCompact ? 0 : 1) + keys
    return { isCompact, mapTop, mapRows: room.rows - mapTop - under, listRows, detailRows }
  }
  const roomy = share(false)
  const plan = roomy.mapRows >= Math.min(said.mapNeeds, ROOMY_MAP_ROWS) ? roomy : share(true)
  return { ...plan, mapRows: Math.max(MIN_MAP_ROWS, plan.mapRows) }
}
