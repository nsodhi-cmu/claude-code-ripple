import type { RippleMap, RippleNode } from '../types'
import { headerText } from './model'

// Pure drawing math: the terminal's tree view as rows of styled text, and the
// desktop's ring view as an SVG string. Nothing here touches `$`
// (render.test.ts tests it directly); register.tsx turns it into elements.

// --------------------------------------------------------------------- family

type Family = {
  changed: RippleNode[]
  /** Direct callers. */
  near: RippleNode[]
  /** Callers of callers. */
  far: RippleNode[]
  callees: RippleNode[]
  /** A caller's id to the id of the node one ring in that it calls. */
  parentOf: Map<string, string>
  /** A changed node's id to what it calls. */
  calleesOf: Map<string, RippleNode[]>
}

/**
 * Sorts the nodes into rings and gives each caller a parent. An edge counts in
 * either direction, since a model that swaps `from` and `to` still means it.
 */
function familyOf(map: RippleMap): Family {
  const changed = map.nodes.filter(node => node.kind === 'changed')
  const near = map.nodes.filter(node => node.kind === 'caller' && node.depth <= 1)
  const far = map.nodes.filter(node => node.kind === 'caller' && node.depth > 1)
  const callees = map.nodes.filter(node => node.kind === 'callee')

  const links = new Set(
    map.edges.flatMap(edge => [`${edge.from}\n${edge.to}`, `${edge.to}\n${edge.from}`]),
  )
  const isLinked = (a: RippleNode, b: RippleNode): boolean => links.has(`${a.id}\n${b.id}`)

  const parentOf = new Map<string, string>()
  for (const caller of near) {
    const parent = changed.find(node => isLinked(caller, node)) ?? changed[0]
    if (parent !== undefined) parentOf.set(caller.id, parent.id)
  }
  for (const caller of far) {
    const parent =
      near.find(node => isLinked(caller, node)) ??
      changed.find(node => isLinked(caller, node)) ??
      changed[0]
    if (parent !== undefined) parentOf.set(caller.id, parent.id)
  }

  const calleesOf = new Map<string, RippleNode[]>()
  for (const callee of callees) {
    const owner = changed.find(node => isLinked(callee, node)) ?? changed[0]
    if (owner === undefined) continue
    calleesOf.set(owner.id, [...(calleesOf.get(owner.id) ?? []), callee])
  }

  return { changed, near, far, callees, parentOf, calleesOf }
}

// ------------------------------------------------------------------ tree view

export type Tone = 'changed' | 'review' | 'updated' | 'ok' | 'dim'

/** One node of the tree, or (with no glyph) a `calls → a, b` line. */
export type TreeRow = {
  id: string
  /** The guides before the glyph: `├─ `, `│  └─ `. */
  lead: string
  /** The guides for a second line under this row. */
  under: string
  glyph: string
  name: string
  /** `file:line`. */
  loc: string
  /** Status words: `signature changed`, `NEEDS REVIEW · untested`. */
  note: string
  reason: string
  tone: Tone
}

const GLYPH: Record<Exclude<Tone, 'dim'>, string> = {
  changed: '◉',
  review: '●',
  updated: '✓',
  ok: '○',
}

function toneOf(node: RippleNode): Exclude<Tone, 'dim'> {
  if (node.kind === 'changed') return 'changed'
  if (node.status === 'needs-review') return 'review'
  return node.status === 'updated' ? 'updated' : 'ok'
}

function noteOf(node: RippleNode): string {
  const parts: string[] = []
  if (node.kind === 'changed') {
    if (node.change === undefined) parts.push('changed')
    else if (node.change === 'added' || node.change === 'removed') parts.push(node.change)
    else parts.push(`${node.change} changed`)
  }
  if (node.status === 'needs-review') parts.push('NEEDS REVIEW')
  if (node.status === 'updated') parts.push('updated')
  if (!node.tested && node.kind !== 'callee') parts.push('untested')
  return parts.join(' · ')
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value
}

/** Breaks `value` into at most `maxLines` lines of `width`, at spaces where it can. */
function wrapWords(value: string, width: number, maxLines: number): string[] {
  if (value.length <= width) return [value]
  const lines: string[] = []
  let line = ''
  for (const word of value.split(' ')) {
    if (line === '' || line.length + 1 + word.length <= width) {
      line = line === '' ? word : `${line} ${word}`
      continue
    }
    lines.push(line)
    line = word
  }
  lines.push(line)
  if (lines.length <= maxLines) return lines
  const last = lines.slice(maxLines - 1).join(' ')
  return [...lines.slice(0, maxLines - 1), clip(last, width)]
}

function locOf(node: RippleNode): string {
  return node.line > 0 ? `${node.file}:${node.line}` : node.file
}

type Branch = { node: RippleNode; children: Branch[]; calls: RippleNode[] }

/** The tree view's rows, top to bottom: each changed function, then its callers. */
export function treeRows(map: RippleMap): TreeRow[] {
  const family = familyOf(map)
  const callers = [...family.near, ...family.far]
  const branchOf = (node: RippleNode): Branch => ({
    node,
    children: callers.filter(caller => family.parentOf.get(caller.id) === node.id).map(branchOf),
    calls: family.calleesOf.get(node.id) ?? [],
  })
  const roots =
    family.changed.length > 0
      ? family.changed
      : callers.filter(caller => !family.parentOf.has(caller.id))

  const rows: TreeRow[] = []
  const walk = (branch: Branch, lead: string, rest: string): void => {
    const { node } = branch
    const tone = toneOf(node)
    rows.push({
      id: node.id,
      lead,
      under: rest + (branch.children.length > 0 ? '│ ' : '  '),
      glyph: GLYPH[tone],
      name: clip(node.name, 28),
      loc: locOf(node),
      note: noteOf(node),
      reason: node.reason ?? '',
      tone,
    })
    branch.children.forEach((child, index) => {
      const isLast = index === branch.children.length - 1
      walk(child, rest + (isLast ? '└─ ' : '├─ '), rest + (isLast ? '   ' : '│  '))
    })
    if (branch.calls.length > 0) {
      rows.push(callsRow(`${node.id}:calls`, `${rest}   `, branch.calls))
    }
  }
  for (const root of roots) walk(branchOf(root), '', '')
  if (family.changed.length === 0 && family.callees.length > 0) {
    rows.push(callsRow('calls', '', family.callees))
  }
  return rows
}

function callsRow(id: string, lead: string, callees: RippleNode[]): TreeRow {
  return {
    id,
    lead,
    under: lead,
    glyph: '',
    name: `calls → ${callees.map(callee => callee.name).join(', ')}`,
    loc: '',
    note: '',
    reason: '',
    tone: 'dim',
  }
}

/** A run of one style within a line. */
export type Segment = { text: string; tone: Tone | 'guide' | 'plain'; isBold?: true }
export type TreeLine = { id: string; segments: Segment[] }

/** From this many columns a node's three parts sit in columns of their own. */
export const WIDE_COLUMNS = 88
/** A note or a reason is wrapped onto this many lines at most. */
const WRAP_LINES = 3

/**
 * Lays the rows out for `width` columns. Wide: name, `file:line` and note in
 * three aligned columns. Narrow (a docked pane): the note beside the name and
 * the location under it, or beside it where there is no note and it fits.
 * A reason too long for its room wraps under itself, the guides kept.
 */
export function layoutTree(rows: TreeRow[], width: number): TreeLine[] {
  const lines: TreeLine[] = []
  const isWide = width >= WIDE_COLUMNS
  const nodes = rows.filter(row => row.glyph !== '')
  const headWidth = Math.min(38, Math.max(0, ...nodes.map(row => row.lead.length + 2 + row.name.length)))
  const locWidth = Math.min(32, Math.max(0, ...nodes.map(row => row.loc.length)))

  for (const row of rows) {
    if (row.glyph === '') {
      lines.push({
        id: row.id,
        segments: [
          { text: row.lead, tone: 'guide' },
          { text: row.name, tone: 'dim' },
        ],
      })
      continue
    }
    const head: Segment[] = [
      { text: row.lead, tone: 'guide' },
      {
        text: `${row.glyph} ${row.name}`,
        tone: row.tone,
        ...(row.tone === 'changed' || row.tone === 'review' ? { isBold: true as const } : {}),
      },
    ]
    const noteTone = row.tone === 'ok' ? 'dim' : row.tone

    const used = row.lead.length + 2 + row.name.length

    if (isWide) {
      const tail = [row.note, row.reason].filter(part => part !== '').join(' · ')
      const tailColumn = headWidth + 2 + locWidth + 2
      const room = width - tailColumn
      const [first = '', ...more] = room >= 24 ? wrapWords(tail, room, WRAP_LINES) : [tail]
      const segments = [...head]
      if (row.loc !== '' || tail !== '') {
        segments.push({ text: ' '.repeat(Math.max(0, headWidth - used) + 2), tone: 'plain' })
        segments.push({ text: tail === '' ? row.loc : row.loc.padEnd(locWidth + 2), tone: 'dim' })
      }
      if (first !== '') segments.push({ text: first, tone: noteTone })
      lines.push({ id: row.id, segments })
      more.forEach((part, index) => {
        lines.push({
          id: `${row.id}:more:${index + 1}`,
          segments: [
            { text: row.under.padEnd(tailColumn), tone: 'guide' },
            { text: part, tone: noteTone },
          ],
        })
      })
      continue
    }

    if (row.note === '' && row.reason === '' && used + 2 + row.loc.length <= width) {
      const segments = [...head]
      if (row.loc !== '') segments.push({ text: `  ${row.loc}`, tone: 'dim' })
      lines.push({ id: row.id, segments })
      continue
    }
    const segments = [...head]
    if (row.note !== '') segments.push({ text: `  ${row.note}`, tone: noteTone })
    lines.push({ id: row.id, segments })
    const detail = [row.loc, row.reason].filter(part => part !== '').join(' · ')
    if (detail === '') continue
    wrapWords(detail, Math.max(16, width - row.under.length), WRAP_LINES).forEach((part, index) => {
      lines.push({
        id: index === 0 ? `${row.id}:detail` : `${row.id}:detail:${index}`,
        segments: [
          { text: row.under, tone: 'guide' },
          { text: part, tone: 'dim' },
        ],
      })
    })
  }
  return lines
}

export function lineText(line: TreeLine): string {
  return line.segments.map(segment => segment.text).join('')
}

// ------------------------------------------------------------------ ring view

/** The ring view's geometry, in the SVG's own units. */
export const RING = { size: 640, center: 320, changed: 30, callees: 70, near: 140, far: 230 } as const

export type RingName = 'center' | 'callees' | 'near' | 'far'

export type Placed = {
  node: RippleNode
  ring: RingName
  /** Radians, 0 pointing right and -π/2 up. */
  angle: number
  x: number
  y: number
  /** How much of the ring this node has to itself, in units along it. */
  room: number
}

const TOP = -Math.PI / 2
const TURN = Math.PI * 2
/** The most a far node is kept from its neighbour while it sits by its caller. */
const FAR_GAP = 0.42

function tenth(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Seats the far ring. Each node goes beside the caller it calls, so its edge
 * runs straight out and none cross; siblings fan around that spoke. Only a
 * ring too full to hold them that way is spread evenly instead.
 */
function seatFar(
  far: RippleNode[],
  spokeOf: (node: RippleNode) => number | undefined,
): Array<{ node: RippleNode; angle: number; room: number }> {
  const gap = Math.min(FAR_GAP, (TURN / Math.max(far.length, 1)) * 0.9)
  const bySpoke = new Map<number, RippleNode[]>()
  const loose: RippleNode[] = []
  for (const node of far) {
    const spoke = spokeOf(node)
    if (spoke === undefined) loose.push(node)
    else bySpoke.set(spoke, [...(bySpoke.get(spoke) ?? []), node])
  }

  const seats: Array<{ node: RippleNode; angle: number }> = []
  for (const [spoke, group] of bySpoke) {
    group.forEach((node, index) => {
      seats.push({ node, angle: spoke + (index - (group.length - 1) / 2) * gap })
    })
  }
  seats.sort((a, b) => a.angle - b.angle)

  let previous: number | undefined
  for (const seat of seats) {
    if (previous !== undefined && seat.angle - previous < gap) seat.angle = previous + gap
    previous = seat.angle
  }
  for (const node of loose) {
    previous = previous === undefined ? TOP : previous + gap
    seats.push({ node, angle: previous })
  }

  const first = seats[0]
  if (first !== undefined && previous !== undefined && previous - first.angle > TURN - gap) {
    const step = TURN / seats.length
    seats.forEach((seat, index) => {
      seat.angle = first.angle + index * step
    })
  }
  // The seats are in angle order: a seat's room is the way to its nearer neighbour.
  return seats.map((seat, index) => {
    const before = seats[(index - 1 + seats.length) % seats.length] ?? seat
    const after = seats[(index + 1) % seats.length] ?? seat
    const turn = (angle: number): number => (seats.length === 1 ? TURN : ((angle % TURN) + TURN) % TURN)
    return {
      ...seat,
      room: RING.far * Math.min(turn(seat.angle - before.angle), turn(after.angle - seat.angle)),
    }
  })
}

/**
 * Where every node sits: changed functions at the center, callees on the
 * inner ring, direct callers on the next and their callers on the outer one.
 */
export function ringLayout(map: RippleMap): Placed[] {
  const family = familyOf(map)
  const placed: Placed[] = []
  const angleOf = new Map<string, number>()
  const put = (node: RippleNode, ring: RingName, radius: number, angle: number, room: number): void => {
    angleOf.set(node.id, angle)
    placed.push({
      node,
      ring,
      angle,
      x: tenth(RING.center + radius * Math.cos(angle)),
      y: tenth(RING.center + radius * Math.sin(angle)),
      room,
    })
  }

  const { changed, near, far, callees } = family
  const [only] = changed
  if (changed.length === 1 && only !== undefined) {
    put(only, 'center', 0, TOP, RING.callees * 2)
  } else {
    const radius = Math.min(52, Math.max(RING.changed, (changed.length * 26) / TURN))
    const step = TURN / Math.max(changed.length, 1)
    changed.forEach((node, index) => put(node, 'center', radius, TOP + index * step, radius * step))
  }

  const orderOf = new Map(changed.map((node, index) => [node.id, index]))
  const rank = (node: RippleNode): number => orderOf.get(family.parentOf.get(node.id) ?? '') ?? 0
  const nearStep = TURN / Math.max(near.length, 1)
  const nearSorted = [...near].sort((a, b) => rank(a) - rank(b))
  // With several changed functions the ring is turned so that the first group
  // of callers is centered on the function it calls; the rest follow in order.
  const [lead] = nearSorted
  const leadGroup = lead === undefined ? 0 : nearSorted.filter(node => rank(node) === rank(lead)).length
  const leadAngle = lead === undefined ? undefined : angleOf.get(family.parentOf.get(lead.id) ?? '')
  const nearStart =
    changed.length > 1 && leadAngle !== undefined ? leadAngle - ((leadGroup - 1) / 2) * nearStep : TOP
  nearSorted.forEach((node, index) =>
    put(node, 'near', RING.near, nearStart + index * nearStep, RING.near * nearStep),
  )

  // Half a step off the callers' spokes, so no callee sits on a caller's edge.
  const calleeStep = TURN / Math.max(callees.length, 1)
  callees.forEach((node, index) =>
    put(node, 'callees', RING.callees, nearStart + nearStep / 2 + index * calleeStep, RING.callees * calleeStep),
  )

  const seats = seatFar(far, node => {
    const parent = family.parentOf.get(node.id)
    const parentNode = near.find(candidate => candidate.id === parent)
    return parentNode === undefined ? undefined : angleOf.get(parentNode.id)
  })
  for (const seat of seats) put(seat.node, 'far', RING.far, seat.angle, seat.room)

  return placed
}

const INK = {
  ground: '#0b1220',
  ring: '#94a3b8',
  edge: '#475569',
  hot: '#ef4444',
  label: '#e2e8f0',
  sub: '#94a3b8',
  changed: '#f59e0b',
  review: '#ef4444',
  updated: '#22c55e',
  ok: '#64748b',
  callee: '#334155',
} as const

const RING_ORDER: Record<RingName, number> = { center: 0, callees: 1, near: 2, far: 3 }

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fillOf(node: RippleNode): string {
  if (node.kind === 'changed') return INK.changed
  if (node.kind === 'callee') return INK.callee
  if (node.status === 'needs-review') return INK.review
  return node.status === 'updated' ? INK.updated : INK.ok
}

function dotOf(ring: RingName): number {
  return ring === 'center' ? 12 : ring === 'callees' ? 5 : 9
}

function statusWords(node: RippleNode): string {
  const words = noteOf(node).toLowerCase()
  if (words !== '') return words
  return node.kind === 'callee' ? 'callee' : 'ok'
}

type Label = { x: number; nameY: number; subY: number; anchor: 'start' | 'middle' | 'end' }

/**
 * Seats a node's label off its own spoke, where its edges do not run: beside
 * a node above or below the center, over or under one to the left or right.
 */
function labelOf(spot: Placed, isAlone: boolean, hasSub: boolean): Label {
  const dot = dotOf(spot.ring)
  if (spot.ring === 'center' && isAlone) {
    return { x: spot.x, nameY: spot.y + dot + 14, subY: spot.y + dot + 25, anchor: 'middle' }
  }
  const across = Math.cos(spot.angle)
  const down = Math.sin(spot.angle)
  if (Math.abs(down) >= Math.abs(across)) {
    const side = across >= -1e-9 ? 1 : -1
    return {
      x: tenth(spot.x + side * (dot + 6)),
      nameY: tenth(spot.y + (hasSub ? -2 : 4)),
      subY: tenth(spot.y + 9),
      anchor: side > 0 ? 'start' : 'end',
    }
  }
  // A caller and the caller of it share a spoke: one label over, the other under.
  const isUnder = spot.ring === 'far' || (spot.ring !== 'near' && down >= 0)
  if (isUnder) {
    return { x: spot.x, nameY: tenth(spot.y + dot + 13), subY: tenth(spot.y + dot + 24), anchor: 'middle' }
  }
  return {
    x: spot.x,
    nameY: tenth(spot.y - dot - (hasSub ? 17 : 6)),
    subY: tenth(spot.y - dot - 6),
    anchor: 'middle',
  }
}

/** `src/pages/checkout.tsx:22`, cut from the front when it is long. */
function shortLoc(node: RippleNode, max: number): string {
  const loc = locOf(node)
  if (loc.length <= max) return loc
  const tail = node.file.split('/').slice(-1)[0] ?? node.file
  const short = node.line > 0 ? `…/${tail}:${node.line}` : `…/${tail}`
  return short.length <= max ? short : `…${short.slice(short.length - max + 1)}`
}

/** An `Svg` element's `source` may hold this many characters at most. */
export const SVG_LIMIT = 131072

export type SvgOptions = {
  /** Adds `data-*` attributes the web page's hover script reads. */
  hasData?: boolean
  /** Leaves out sublabels and tooltips: the fallback for a picture too large. */
  isBare?: boolean
}

/**
 * What each mark on the map means and where it comes from, in words a reader
 * can check: the web page prints this under the picture. Every label but
 * `updated` is Claude's reading of the code; Ripple runs no tests.
 */
export const KEY: ReadonlyArray<{ label: string; fill: string; isDashed?: true; means: string }> = [
  {
    label: 'changed',
    fill: INK.changed,
    means: 'A function your uncommitted changes touch. Claude names these from the diff; they sit at the center.',
  },
  {
    label: 'needs review',
    fill: INK.review,
    means:
      'A caller Claude judged the change may break or alter: for example it passes the old number of arguments. Hover it for the reason.',
  },
  {
    label: 'updated',
    fill: INK.updated,
    means:
      'A flagged caller that has itself been changed since this map was made. Ripple sets this from the diff; it does not prove the fix is right.',
  },
  { label: 'ok', fill: INK.ok, means: 'A caller Claude judged the change does not affect.' },
  {
    label: 'callee',
    fill: INK.callee,
    means: 'A function the changed one calls. Shown for context on the dashed inner ring; it is not checked.',
  },
  {
    label: 'untested',
    fill: INK.ground,
    isDashed: true,
    means:
      'Claude found no test file that mentions this function by name. Nothing is run: it says a test may be missing, not that one fails.',
  },
]

/**
 * The ring view: the changed functions at the center and what they reach on
 * rings around them. Self-contained, on its own dark ground, so it reads the
 * same in a light or a dark app.
 */
export function ringSvg(map: RippleMap, options: SvgOptions = {}): string {
  const spots = ringLayout(map)
  const spotOf = new Map(spots.map(spot => [spot.node.id, spot]))
  const isAlone = spots.filter(spot => spot.ring === 'center').length === 1
  const { size, center } = RING
  const out: string[] = []

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">`,
    `<title>${esc(headerText(map))}</title>`,
    '<style>.n:hover circle{stroke:#fff;stroke-width:2;stroke-dasharray:none}.n:hover text{fill:#fff}</style>',
    `<rect width="${size}" height="${size}" rx="14" fill="${INK.ground}"/>`,
  )

  // The ripple: faint rings behind everything, the callee ring dashed.
  out.push(`<g fill="none" stroke="${INK.ring}">`)
  for (const [radius, opacity] of [
    [RING.near, 0.2],
    [(RING.near + RING.far) / 2, 0.08],
    [RING.far, 0.16],
    [RING.far + 45, 0.07],
  ] as const) {
    out.push(`<circle cx="${center}" cy="${center}" r="${radius}" stroke-opacity="${opacity}"/>`)
  }
  out.push(
    `<circle cx="${center}" cy="${center}" r="${RING.callees}" stroke-opacity="0.26" stroke-dasharray="3 5"/>`,
    '</g>',
  )

  out.push('<g stroke-linecap="round">')
  for (const edge of map.edges) {
    const from = spotOf.get(edge.from)
    const to = spotOf.get(edge.to)
    if (from === undefined || to === undefined) continue
    // An edge takes the color of the caller it leads out to: red while that
    // caller needs review, green once it has been updated.
    const outer = RING_ORDER[from.ring] >= RING_ORDER[to.ring] ? from : to
    const isHot = outer.node.status === 'needs-review'
    const isDone = outer.node.status === 'updated'
    const stroke = isHot ? INK.hot : isDone ? INK.updated : INK.edge
    out.push(
      `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="${isHot || isDone ? 1.6 : 1}" stroke-opacity="${isHot || isDone ? 0.85 : 0.7}"/>`,
    )
  }
  out.push('</g>')

  for (const spot of spots) {
    const { node } = spot
    const dot = dotOf(spot.ring)
    const isCallee = spot.ring === 'callees'
    // A `file:line` under the name needs about 130 units clear; a name alone, 60.
    const isDense = spot.room < 60
    const hasSub = options.isBare !== true && !isCallee && spot.room >= 120
    const label = labelOf(spot, isAlone, hasSub)
    const name = clip(node.name, isDense ? 10 : 18)
    const outline = isCallee
      ? `stroke="${INK.ok}" stroke-width="1"`
      : node.tested
        ? `stroke="${INK.label}" stroke-opacity="0.75" stroke-width="1.2"`
        : `stroke="${INK.label}" stroke-width="1.6" stroke-dasharray="3 2.4"`
    const halo = `paint-order="stroke" stroke="${INK.ground}" stroke-width="3" stroke-linejoin="round"`
    const data =
      options.hasData === true
        ? ` data-name="${esc(node.name)}" data-loc="${esc(locOf(node))}" data-status="${esc(statusWords(node))}" data-reason="${esc(node.reason ?? '')}"`
        : ''

    out.push(`<g class="n"${data}>`)
    // The web page draws its own tooltip from the data attributes.
    if (options.isBare !== true && options.hasData !== true) {
      const tip = [`${node.name} · ${locOf(node)}`, statusWords(node), node.reason ?? '']
        .filter(part => part !== '')
        .join('\n')
      out.push(`<title>${esc(tip)}</title>`)
    }
    out.push(`<circle cx="${spot.x}" cy="${spot.y}" r="${dot}" fill="${fillOf(node)}" ${outline}/>`)
    out.push(
      `<text x="${label.x}" y="${label.nameY}" text-anchor="${label.anchor}" font-size="${isCallee ? 9 : 11}" fill="${isCallee ? INK.sub : INK.label}" ${halo}>${esc(name)}</text>`,
    )
    if (hasSub) {
      out.push(
        `<text x="${label.x}" y="${label.subY}" text-anchor="${label.anchor}" font-size="8.5" fill="${INK.sub}" ${halo}>${esc(shortLoc(node, 26))}</text>`,
      )
    }
    out.push('</g>')
  }

  out.push('</svg>')
  const svg = out.join('')
  // A full map is a fifth of the limit; this only guards a pathological one.
  return svg.length > SVG_LIMIT && options.isBare !== true ? ringSvg(map, { ...options, isBare: true }) : svg
}

/**
 * `.ripple/graph.html`: the ring view, `file:line` beside the pointer, and
 * under the picture what every mark means. A still page: nothing moves.
 */
export function graphHtml(map: RippleMap): string {
  const header = esc(headerText(map))
  const key = KEY.map(
    entry =>
      `<li><span class="dot${entry.isDashed ? ' dashed' : ''}" style="background:${entry.fill}"></span><b>${esc(entry.label)}</b><span>${esc(entry.means)}</span></li>`,
  )
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${header}</title>`,
    '<style>',
    'html,body{margin:0;background:#060a14;color:#e2e8f0;font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
    'main{min-height:100vh;display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px;box-sizing:border-box}',
    'h1{font-size:14px;font-weight:600;margin:0}',
    'svg{width:min(92vw,84vh);height:auto}',
    '#tip{position:fixed;pointer-events:none;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 9px;max-width:46ch;white-space:pre-wrap}',
    '#tip b{color:#fbbf24;font-weight:600}',
    '#tip i{color:#94a3b8;font-style:normal}',
    '.key{list-style:none;margin:0;padding:0;max-width:min(92vw,84vh);display:grid;gap:7px}',
    '.key li{display:grid;grid-template-columns:14px 13ch 1fr;gap:8px;align-items:start;line-height:1.45}',
    '.key .dot{width:10px;height:10px;border-radius:50%;margin-top:4px;border:1px solid rgba(226,232,240,.6);box-sizing:border-box}',
    '.key .dashed{border:1.5px dashed #e2e8f0}',
    '.key span:last-child,.note{color:#94a3b8}',
    '.note{max-width:min(92vw,84vh);margin:0;line-height:1.45}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${header}</h1>`,
    ringSvg(map, { hasData: true }),
    '<ul class="key">',
    ...key,
    '</ul>',
    '<p class="note">Ripple runs no tests and no analysis of its own. Claude traced the callers with the tool named in the title (a language server, the type checker, or text search) and judged each one; Ripple draws that, and marks a caller updated when the diff shows it changed afterwards.</p>',
    '</main>',
    '<div id="tip" hidden></div>',
    '<script>',
    "const tip = document.getElementById('tip')",
    "for (const node of document.querySelectorAll('g.n')) {",
    "  node.addEventListener('mousemove', event => {",
    '    const { name, loc, status, reason } = node.dataset',
    "    tip.replaceChildren(Object.assign(document.createElement('b'), { textContent: name }), ' ' + loc)",
    "    tip.append(Object.assign(document.createElement('i'), { textContent: '\\n' + status + (reason ? ' · ' + reason : '') }))",
    "    tip.style.left = Math.min(event.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'",
    "    tip.style.top = event.clientY + 16 + 'px'",
    '    tip.hidden = false',
    '  })',
    "  node.addEventListener('mouseleave', () => { tip.hidden = true })",
    '}',
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
