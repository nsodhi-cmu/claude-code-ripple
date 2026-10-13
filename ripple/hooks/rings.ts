import type { RippleNode, RippleReport } from '../types'
import { locOf, wordsOf } from './draw'
import { clip, headerText } from './map'

// The ring view: the map as an SVG string, for the surfaces that draw no graph.

type Family = {
  changed: RippleNode[]
  /** Dependents one step out. */
  near: RippleNode[]
  /** Dependents farther out. */
  far: RippleNode[]
  dependencies: RippleNode[]
  /** A dependent's id to the id of the node it sits out from: a changed one, or a near dependent. */
  parentOf: Map<string, string>
}

/** Sorts the nodes into rings and gives each dependent the node it sits out from. */
function familyOf(map: RippleReport): Family {
  const changed = map.nodes.filter(node => node.role === 'changed')
  const near = map.nodes.filter(node => node.role === 'dependent' && node.depth <= 1)
  const far = map.nodes.filter(node => node.role === 'dependent' && node.depth > 1)
  const dependencies = map.nodes.filter(node => node.role === 'dependency')
  const used = (node: RippleNode, among: RippleNode[]): RippleNode | undefined =>
    among.find(other => map.edges.some(edge => edge.from === node.id && edge.to === other.id))

  const parentOf = new Map<string, string>()
  for (const node of near) {
    const parent = used(node, changed) ?? changed[0]
    if (parent !== undefined) parentOf.set(node.id, parent.id)
  }
  for (const node of [...far].sort((a, b) => a.depth - b.depth)) {
    const inner = used(node, near)
    const parent = inner?.id ?? parentOf.get(used(node, far)?.id ?? '')
    if (parent !== undefined) parentOf.set(node.id, parent)
  }
  return { changed, near, far, dependencies, parentOf }
}

/** The ring view's geometry, in the SVG's own units. */
export const RING = { size: 640, center: 320, changed: 30, dependencies: 70, near: 140, far: 230 } as const

export type RingName = 'center' | 'dependencies' | 'near' | 'far'

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
/** The most a far node is kept from its neighbor while it sits by the dependent it uses. */
const FAR_GAP = 0.42

function tenth(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Seats the far ring. Each node goes beside the dependent it uses, so its edge
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
  // The seats are in angle order: a seat's room is the way to its nearer neighbor.
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
 * Where every node sits: changed symbols at the center, dependencies on the
 * inner ring, direct dependents on the next, and their dependents on the outer one.
 */
export function ringLayout(map: RippleReport): Placed[] {
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

  const { changed, near, far, dependencies } = family
  const [only] = changed
  if (changed.length === 1 && only !== undefined) {
    put(only, 'center', 0, TOP, RING.dependencies * 2)
  } else {
    const radius = Math.min(52, Math.max(RING.changed, (changed.length * 26) / TURN))
    const step = TURN / Math.max(changed.length, 1)
    changed.forEach((node, index) => put(node, 'center', radius, TOP + index * step, radius * step))
  }

  const orderOf = new Map(changed.map((node, index) => [node.id, index]))
  const rank = (node: RippleNode): number => orderOf.get(family.parentOf.get(node.id) ?? '') ?? 0
  const nearStep = TURN / Math.max(near.length, 1)
  const nearSorted = [...near].sort((a, b) => rank(a) - rank(b))
  // With several changed symbols the ring is turned so that the first group
  // of dependents is centered on the symbol it uses; the rest follow in order.
  const [lead] = nearSorted
  const leadGroup = lead === undefined ? 0 : nearSorted.filter(node => rank(node) === rank(lead)).length
  const leadAngle = lead === undefined ? undefined : angleOf.get(family.parentOf.get(lead.id) ?? '')
  const nearStart =
    changed.length > 1 && leadAngle !== undefined ? leadAngle - ((leadGroup - 1) / 2) * nearStep : TOP
  nearSorted.forEach((node, index) =>
    put(node, 'near', RING.near, nearStart + index * nearStep, RING.near * nearStep),
  )

  // Half a step off the dependents' spokes, so no dependency sits on a dependent's edge.
  const dependencyStep = TURN / Math.max(dependencies.length, 1)
  dependencies.forEach((node, index) =>
    put(node, 'dependencies', RING.dependencies, nearStart + nearStep / 2 + index * dependencyStep, RING.dependencies * dependencyStep),
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
  label: '#e2e8f0',
  sub: '#94a3b8',
  changed: '#38bdf8',
  breaks: '#ef4444',
  review: '#f59e0b',
  ok: '#64748b',
  dependency: '#334155',
} as const

const RING_ORDER: Record<RingName, number> = { center: 0, dependencies: 1, near: 2, far: 3 }

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fillOf(node: RippleNode): string {
  if (node.role === 'changed') return INK.changed
  if (node.role === 'dependency') return INK.dependency
  return INK[node.risk]
}

function dotOf(ring: RingName): number {
  return ring === 'center' ? 12 : ring === 'dependencies' ? 5 : 9
}

function statusWords(node: RippleNode): string {
  const words = wordsOf(node).join(' · ')
  if (words !== '') return words
  return node.role === 'dependency' ? 'dependency' : 'ok'
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
  // A dependent and the dependent of it share a spoke: one label over, the other under.
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
  /** Leaves out sublabels and tooltips: the fallback for a picture too large. */
  isBare?: boolean
}

/**
 * The ring view: the changed symbols at the center and what they reach on
 * rings around them. Self-contained, on its own dark ground, so it reads the
 * same in a light or a dark app.
 */
export function ringSvg(map: RippleReport, options: SvgOptions = {}): string {
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

  // The ripple: faint rings behind everything, the dependency ring dashed.
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
    `<circle cx="${center}" cy="${center}" r="${RING.dependencies}" stroke-opacity="0.26" stroke-dasharray="3 5"/>`,
    '</g>',
  )

  out.push('<g stroke-linecap="round">')
  for (const edge of map.edges) {
    const from = spotOf.get(edge.from)
    const to = spotOf.get(edge.to)
    if (from === undefined || to === undefined) continue
    // An edge takes the color of the dependent it leads out to, while that one is at risk.
    const outer = RING_ORDER[from.ring] >= RING_ORDER[to.ring] ? from : to
    const isHot = outer.node.risk !== 'ok'
    out.push(
      `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${isHot ? INK[outer.node.risk] : INK.edge}" stroke-width="${isHot ? 1.6 : 1}" stroke-opacity="${isHot ? 0.85 : 0.7}"/>`,
    )
  }
  out.push('</g>')

  for (const spot of spots) {
    const { node } = spot
    const dot = dotOf(spot.ring)
    const isDependency = spot.ring === 'dependencies'
    const isDense = spot.room < 60
    const hasSub = options.isBare !== true && !isDependency && spot.room >= 120
    const label = labelOf(spot, isAlone, hasSub)
    const name = clip(node.name, isDense ? 10 : 18)
    const outline = isDependency
      ? `stroke="${INK.ok}" stroke-width="1"`
      : node.isTested
        ? `stroke="${INK.label}" stroke-opacity="0.75" stroke-width="1.2"`
        : `stroke="${INK.label}" stroke-width="1.6" stroke-dasharray="3 2.4"`
    const halo = `paint-order="stroke" stroke="${INK.ground}" stroke-width="3" stroke-linejoin="round"`

    out.push('<g class="n">')
    if (options.isBare !== true) {
      const tip = [`${node.name} · ${locOf(node)}`, statusWords(node), node.reason ?? '']
        .filter(part => part !== '')
        .join('\n')
      out.push(`<title>${esc(tip)}</title>`)
    }
    out.push(`<circle cx="${spot.x}" cy="${spot.y}" r="${dot}" fill="${fillOf(node)}" ${outline}/>`)
    out.push(
      `<text x="${label.x}" y="${label.nameY}" text-anchor="${label.anchor}" font-size="${isDependency ? 9 : 11}" fill="${isDependency ? INK.sub : INK.label}" ${halo}>${esc(name)}</text>`,
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
  return svg.length > SVG_LIMIT && options.isBare !== true ? ringSvg(map, { ...options, isBare: true }) : svg
}
