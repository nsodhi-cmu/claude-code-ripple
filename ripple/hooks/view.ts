import type { RippleMode, RippleNode, RippleReport } from '../types'
import { locOf, markOf } from './draw'
import type { Drawing, Move, Paint, Room } from './draw'
import { GRAPH_COLUMNS, GRAPH_ROWS, drawGraph, stepInGraph } from './graph'
import { flagged, neighborsOf } from './map'
import { drawTree, stepInTree } from './tree'

// What the person is looking at: which view, and which node is selected in
// it. Nothing here touches `$`.

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

/** From this many rows a pane has room for everything said around the map. */
const ROOMY_ROWS = 28
/** The fewest rows the map is drawn in, however short the pane. */
const MIN_MAP_ROWS = 5
/** The pane's keys, side by side, take about this many columns before they wrap. */
const KEYS_COLUMNS = 90
/** The blank rows of a roomy pane: over the map, under it, and over the keys. */
const GAPS = 3

/** What the pane says around the map, as far as it decides how many rows that takes. */
export type Said = { summary: string; verdict: string; links: string; hasNotice: boolean }

/**
 * How a pane's rows are shared out. A roomy pane says everything around the
 * map; a short one keeps the header, a line or two on the selected node, and
 * the keys, and gives the map the rest.
 */
export function planOf(room: Room, said: Said): { isCompact: boolean; mapRows: number } {
  const lines = (text: string): number => Math.ceil(text.length / Math.max(1, room.columns))
  const keys = room.columns >= KEYS_COLUMNS ? 1 : 2
  const notice = said.hasNotice ? 1 : 0
  const isCompact = room.rows < ROOMY_ROWS
  const header = 1
  const detail = 1 + lines(said.verdict) + lines(said.links)
  const around = isCompact
    ? header + notice + 1 + Math.min(1, lines(said.verdict)) + keys
    : header + 1 + lines(said.summary) + notice + 1 + GAPS + detail + keys
  return { isCompact, mapRows: Math.max(MIN_MAP_ROWS, room.rows - around) }
}

/** The id selected after one step of the selection. */
export function stepped(report: RippleReport, mode: RippleMode, selected: string | null, move: Move): string | null {
  const from = selectedOf(report, selected)
  if (from === undefined) return selected
  return (mode === 'tree' ? stepInTree : stepInGraph)(report, from.id, move)
}

/** The id of the next flagged node after the selected one, round and round; the selection kept when nothing is flagged. */
export function nextFlagged(report: RippleReport, selected: string | null): string | null {
  const all = flagged(report)
  const at = all.findIndex(node => node.id === selectedOf(report, selected)?.id)
  return all[(at + 1) % Math.max(all.length, 1)]?.id ?? selected
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
  const facts = [node.kind, ...(node.isTested || node.role === 'dependency' ? [] : ['untested'])]
  const lead =
    node.role !== 'changed'
      ? node.risk
      : node.change === 'signature' || node.change === 'behavior'
        ? `${node.change} changed`
        : (node.change ?? 'changed')
  const hasVerdict = node.role === 'changed' || node.risk !== 'ok'
  return {
    name: node.name,
    facts: facts.join(' · '),
    where: locOf(node),
    ...(hasVerdict
      ? { verdict: { text: node.reason === undefined ? lead : `${lead}: ${node.reason}`, paint: markOf(node).paint } }
      : {}),
    links: links.join(' · '),
  }
}
