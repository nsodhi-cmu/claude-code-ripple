import type { RippleEdge, RippleMap, RippleNode, RippleOrigin, RippleReport } from '../types'

// The map as data: reading what the mapper reports, and saying what it holds.

/** The most nodes a map holds. */
export const MAX_NODES = 150
/** The most characters that are kept of each thing a mapper writes. */
const NAME_CHARS = 80
const FILE_CHARS = 300
const KIND_CHARS = 16
const REASON_CHARS = 200
const SUMMARY_CHARS = 240
export const REPORT_TOOL = 'mcp__ripple__report'

const METHODS = ['lsp', 'tooling', 'grep'] as const
const ROLES = ['changed', 'dependent', 'dependency'] as const
const RISKS = ['ok', 'review', 'breaks'] as const
const CHANGES = ['signature', 'behavior', 'renamed', 'added', 'removed'] as const
const SCOPES = ['uncommitted', 'branch'] as const

const METHOD_LABEL: Record<RippleReport['method'], string> = {
  lsp: 'LSP',
  tooling: 'type checker',
  grep: 'text search',
}

export const REPORT_DESCRIPTION =
  "Ripple's mapper reports the impact map of a change with this tool. Nothing else calls it."

/** The report tool's input schema: a RippleReport as a mapper writes one, with no depths. */
export const REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['method', 'nodes', 'edges', 'summary'],
  properties: {
    method: {
      type: 'string',
      enum: [...METHODS],
      description: 'What you mainly relied on to find dependents.',
    },
    summary: {
      type: 'string',
      description: 'What the change puts at risk, in one or two short plain sentences, under 200 characters.',
    },
    nodes: {
      type: 'array',
      maxItems: MAX_NODES,
      description: 'One per symbol: the changed ones, their dependents, and their dependencies.',
      items: {
        type: 'object',
        required: ['id', 'name', 'kind', 'file', 'line', 'role', 'risk', 'isTested'],
        properties: {
          id: { type: 'string', description: 'Unique: "<file>:<name>".' },
          name: {
            type: 'string',
            description: 'The symbol as the code writes it; a member as `Type.method` or `Type::method`.',
          },
          kind: {
            type: 'string',
            description:
              'What the language calls it, lowercase: function, method, class, struct, enum, trait, interface, type, field, const.',
          },
          file: { type: 'string', description: 'Path relative to the project root.' },
          line: {
            type: 'integer',
            description:
              '1-based. A changed symbol or a dependency: where it is defined. A dependent: where it first uses what changed.',
          },
          role: {
            type: 'string',
            enum: [...ROLES],
            description:
              'changed: the diff touches it. dependent: it uses a changed symbol, directly or through other dependents. dependency: a changed symbol uses it.',
          },
          change: {
            type: 'string',
            enum: [...CHANGES],
            description: 'Changed symbols only: what about the symbol changed.',
          },
          risk: {
            type: 'string',
            enum: [...RISKS],
            description:
              'breaks when as written it will not compile or type-check, or throws when it runs; review when it runs but its result or side effect may differ; ok otherwise. For dependents, and for a changed symbol that another change breaks.',
          },
          isTested: { type: 'boolean', description: 'True when any test file references it.' },
          reason: {
            type: 'string',
            description:
              'One line. Required when risk is breaks or review: exactly what is wrong. On a changed symbol: what changed.',
          },
        },
      },
    },
    edges: {
      type: 'array',
      description: 'One per use: `from` is the id of the symbol that uses, `to` the id of the symbol it uses.',
      items: {
        type: 'object',
        required: ['from', 'to'],
        properties: { from: { type: 'string' }, to: { type: 'string' } },
      },
    },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A model's string made safe to draw: every control character and run of whitespace is one space. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim() : ''
}

/** The one of `allowed` a model named, in whatever case it wrote it. */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  const named = text(value).toLowerCase()
  return allowed.find(option => option === named)
}

/** A model sometimes sends an array as its JSON text; take either. */
function list(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Cuts `value` to `max` characters, the last of them an ellipsis when anything was cut. */
export function clip(value: string, max: number): string {
  const characters = [...value]
  return characters.length > max ? `${characters.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…` : value
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function readNode(raw: unknown): RippleNode | undefined {
  if (!isRecord(raw)) return undefined
  const name = clip(text(raw.name), NAME_CHARS)
  const file = clip(text(raw.file).replace(/\\/g, '/'), FILE_CHARS)
  if (name === '' || file === '') return undefined
  const change = oneOf(CHANGES, raw.change)
  const role = oneOf(ROLES, raw.role) ?? (change === undefined ? 'dependent' : 'changed')
  const kind = text(raw.kind)
    .toLowerCase()
    .replace(/[^a-z -]/g, '')
    .slice(0, KIND_CHARS)
  const line = Number(raw.line)
  const reason = clip(text(raw.reason), REASON_CHARS)
  return {
    id: text(raw.id) || `${file}:${name}`,
    name,
    kind: kind === '' ? 'symbol' : kind,
    file,
    line: Number.isFinite(line) ? Math.max(0, Math.round(line)) : 0,
    role,
    depth: 0,
    risk: role === 'dependency' ? 'ok' : (oneOf(RISKS, raw.risk) ?? 'ok'),
    isTested: raw.isTested === true || raw.isTested === 'true',
    ...(role === 'changed' && change !== undefined ? { change } : {}),
    ...(reason === '' ? {} : { reason }),
  }
}

/** A symbol's place along the flow of use, or a file's: dependents before the change, dependencies after it. */
export function rankOf(at: Pick<RippleNode, 'role' | 'depth'>): number {
  return at.role === 'dependent' ? -at.depth : at.depth
}

/** Whether no symbol of role `from` can be the user of one of role `to`: the edge was reported backward. */
function isImpossible(from: RippleNode['role'], to: RippleNode['role']): boolean {
  return (from === 'changed' && to === 'dependent') || (from === 'dependency' && to !== 'dependency')
}

/**
 * Gives every node its depth, and turns the edges that were reported
 * backward. Depth follows the edges as reported, outward from the changed
 * symbols. What that leaves unreached is then reached along edges read
 * against their direction, since a mapper that swaps `from` and `to` still
 * means the use; those edges are turned, and so is any edge whose roles
 * cannot be a use. Every other edge stands as reported. A node no edge ties
 * to a changed symbol sits one step out, and what hangs from it beyond it.
 */
function settle(
  nodes: RippleNode[],
  edges: RippleEdge[],
): { nodes: RippleNode[]; edges: RippleEdge[]; turned: number } {
  const users = new Map<string, string[]>()
  const used = new Map<string, string[]>()
  for (const { from, to } of edges) {
    users.set(to, [...(users.get(to) ?? []), from])
    used.set(from, [...(used.get(from) ?? []), to])
  }
  const roleOf = new Map(nodes.map(node => [node.id, node.role]))
  const depthOf = new Map(nodes.filter(node => node.role === 'changed').map(node => [node.id, 0]))
  const backward = new Set<string>()

  const reach = (side: 'dependent' | 'dependency', isEitherWay: boolean): void => {
    const [forward, against] = side === 'dependent' ? [users, used] : [used, users]
    for (let depth = 0; ; depth += 1) {
      const frontier = [...depthOf]
        .filter(([id, at]) => at === depth && (depth === 0 || roleOf.get(id) === side))
        .map(([id]) => id)
      if (frontier.length === 0) return
      for (const id of frontier) {
        const ahead = forward.get(id) ?? []
        for (const other of [...ahead, ...(isEitherWay ? (against.get(id) ?? []) : [])]) {
          if (roleOf.get(other) !== side || depthOf.has(other)) continue
          depthOf.set(other, depth + 1)
          if (!ahead.includes(other)) backward.add(side === 'dependent' ? `${id}\n${other}` : `${other}\n${id}`)
        }
      }
    }
  }
  for (const side of ['dependent', 'dependency'] as const) {
    reach(side, false)
    reach(side, true)
    const loose = new Set(nodes.filter(node => node.role === side && !depthOf.has(node.id)).map(node => node.id))
    const nearer = side === 'dependent' ? used : users
    for (const id of loose) {
      if (!(nearer.get(id) ?? []).some(other => loose.has(other))) depthOf.set(id, 1)
    }
    reach(side, true)
  }

  const seen = new Set<string>()
  const kept: RippleEdge[] = []
  let turned = 0
  for (const edge of edges) {
    const isBackward =
      backward.has(`${edge.from}\n${edge.to}`) ||
      isImpossible(roleOf.get(edge.from) ?? 'changed', roleOf.get(edge.to) ?? 'changed')
    const { from, to } = isBackward ? { from: edge.to, to: edge.from } : edge
    if (seen.has(`${from}\n${to}`)) continue
    seen.add(`${from}\n${to}`)
    kept.push({ from, to })
    if (isBackward) turned += 1
  }
  return {
    nodes: nodes.map(node => ({ ...node, depth: depthOf.get(node.id) ?? 1 })),
    edges: kept,
    turned,
  }
}

/** Past the cap: changed symbols first, then what breaks, then what needs review, then the nearest. */
function capNodes(nodes: RippleNode[]): RippleNode[] {
  const weight = (node: RippleNode): number =>
    node.role === 'changed' ? 0 : node.risk === 'breaks' ? 1 : node.risk === 'review' ? 2 : 2 + node.depth
  const kept = new Set(
    [...nodes]
      .sort((a, b) => weight(a) - weight(b))
      .slice(0, MAX_NODES)
      .map(node => node.id),
  )
  return nodes.filter(node => kept.has(node.id))
}

/** A report as it was read with what had to be repaired in it, or why it could not be read. */
export type Read = { report: RippleReport; notes: string[] } | { error: string }

/**
 * Reads what the mapper reported. A node that cannot be read or repeats an
 * id is dropped, as is an edge that names no node; edges reported backward
 * are turned; past the cap the least important nodes are cut, and what is
 * left is measured again, so that a map reads back from the store as it was
 * drawn. Each of those is noted. Only a report with no readable node list
 * is an error.
 */
export function readReport(input: unknown): Read {
  if (!isRecord(input)) return { error: 'the input is not an object.' }
  const rawNodes = list(input.nodes)
  if (rawNodes === undefined) return { error: '`nodes` must be an array.' }

  const notes: string[] = []
  const ids = new Set<string>()
  const nodes: RippleNode[] = []
  for (const raw of rawNodes) {
    const node = readNode(raw)
    if (node === undefined || ids.has(node.id)) continue
    ids.add(node.id)
    nodes.push(node)
  }
  if (rawNodes.length > 0 && nodes.length === 0) return { error: 'no node had both a `name` and a `file`.' }
  if (nodes.length < rawNodes.length) {
    notes.push(`dropped ${plural(rawNodes.length - nodes.length, 'node')} with a repeated id or no name`)
  }

  const edges: RippleEdge[] = []
  let unnamed = 0
  for (const raw of list(input.edges) ?? []) {
    const from = isRecord(raw) ? text(raw.from) : ''
    const to = isRecord(raw) ? text(raw.to) : ''
    if (ids.has(from) && ids.has(to) && from !== to) edges.push({ from, to })
    else unnamed += 1
  }
  if (unnamed > 0) notes.push(`dropped ${plural(unnamed, 'edge')} that named no node`)

  let settled = settle(nodes, edges)
  if (settled.turned > 0) notes.push(`turned ${plural(settled.turned, 'edge')} that ran from the used to the user`)
  if (settled.nodes.length > MAX_NODES) {
    notes.push(`kept ${MAX_NODES} of ${settled.nodes.length} nodes`)
    const kept = capNodes(settled.nodes)
    const keptIds = new Set(kept.map(node => node.id))
    settled = settle(
      kept,
      settled.edges.filter(edge => keptIds.has(edge.from) && keptIds.has(edge.to)),
    )
  }

  const summary = clip(text(input.summary), SUMMARY_CHARS)
  return {
    report: {
      method: oneOf(METHODS, input.method) ?? 'grep',
      nodes: settled.nodes,
      edges: settled.edges,
      ...(summary === '' ? {} : { summary }),
    },
    notes,
  }
}

/** The map the store kept, or null when there is none or it no longer reads as one. */
export function readStored(value: unknown): RippleMap | null {
  const read = readReport(value)
  if ('error' in read || !isRecord(value)) return null
  const scope = oneOf(SCOPES, value.scope)
  if (scope === undefined || typeof value.print !== 'string') return null
  const origin: RippleOrigin = { scope, base: text(value.base), focus: text(value.focus), print: value.print }
  return { ...read.report, ...origin }
}

export type Counts = { changed: number; dependents: number; dependencies: number; breaks: number; review: number }

export function countsOf(report: RippleReport): Counts {
  const counts: Counts = { changed: 0, dependents: 0, dependencies: 0, breaks: 0, review: 0 }
  for (const node of report.nodes) {
    if (node.role === 'changed') counts.changed += 1
    else if (node.role === 'dependent') counts.dependents += 1
    else counts.dependencies += 1
    if (node.risk === 'breaks') counts.breaks += 1
    else if (node.risk === 'review') counts.review += 1
  }
  return counts
}

/** The nodes at risk, what breaks before what needs review. */
export function flagged(report: RippleReport): RippleNode[] {
  return [
    ...report.nodes.filter(node => node.risk === 'breaks'),
    ...report.nodes.filter(node => node.risk === 'review'),
  ]
}

/** `2 break · 1 to review`, or '' when nothing is flagged. */
function flaggedText(counts: Counts): string {
  const parts: string[] = []
  if (counts.breaks > 0) parts.push(`${counts.breaks} break${counts.breaks === 1 ? 's' : ''}`)
  if (counts.review > 0) parts.push(`${counts.review} to review`)
  return parts.join(' · ')
}

/** `Ripple · 1 change → 6 dependents · 2 break · 1 to review` */
export function headerText(report: RippleReport): string {
  if (report.nodes.length === 0) return 'Ripple · the changes touch no symbol other code uses'
  const counts = countsOf(report)
  const reach = `${plural(counts.changed, 'change')} → ${plural(counts.dependents, 'dependent')}`
  return `Ripple · ${reach} · ${flaggedText(counts) || 'nothing flagged'}`
}

/** `uncommitted changes · via LSP`, `branch since main · via text search · focus: formatPrice` */
export function originText(map: RippleMap): string {
  const parts = [
    map.scope === 'branch' ? `branch since ${map.base}` : 'uncommitted changes',
    `via ${METHOD_LABEL[map.method]}`,
  ]
  if (map.focus !== '') parts.push(`focus: ${map.focus}`)
  return parts.join(' · ')
}

/**
 * The status line under the prompt, which the engine leads with the plugin's
 * name; undefined when there is nothing to say. A map the changes have left
 * behind no longer speaks for them.
 */
export function statusText(map: RippleMap | null, isMapping: boolean, isStale: boolean): string | undefined {
  if (isMapping) return 'mapping…'
  const said = map === null || isStale ? '' : flaggedText(countsOf(map))
  return said === '' ? undefined : `${said} · /ripple`
}

/** What a node uses and what uses it, as the edges have it. */
export function neighborsOf(report: RippleReport, id: string): { uses: RippleNode[]; usedBy: RippleNode[] } {
  const byId = new Map(report.nodes.map(node => [node.id, node]))
  const pick = (ids: string[]): RippleNode[] =>
    ids.flatMap(other => {
      const node = byId.get(other)
      return node === undefined ? [] : [node]
    })
  return {
    uses: pick(report.edges.filter(edge => edge.from === id).map(edge => edge.to)),
    usedBy: pick(report.edges.filter(edge => edge.to === id).map(edge => edge.from)),
  }
}
