import type { RippleNode, RippleReport } from '../types'

// The map by file: what both views draw. A file holds the map's symbols that
// are in it, and stands as far from the change as the files it is linked
// through put it.

/** A file of the map. */
export type MapFile = {
  path: string
  /** What the views call it: the end of its path, as much of it as tells it from the map's other files. */
  name: string
  /** `changed` when any of its symbols is, else `dependent` when any is, else `dependency`. */
  role: RippleNode['role']
  /** Files from the nearest changed one, by the links between them; 0 for a changed file. */
  depth: number
  /** The worst risk among its symbols. */
  risk: RippleNode['risk']
  /** The map's symbols in the file, by line. */
  symbols: RippleNode[]
}

/** `from` uses `to`: a symbol of the one file uses a symbol of the other. */
export type FileLink = { from: string; to: string }

export type FileMap = { files: MapFile[]; links: FileLink[] }

const ROLES = ['changed', 'dependent', 'dependency'] as const
const RISKS = ['breaks', 'review', 'ok'] as const

/** Each path's name: its last part, with the folders before it that it takes to be the only one so named. */
function namesOf(paths: string[]): Map<string, string> {
  const partsOf = new Map(paths.map(path => [path, path.split('/')]))
  const endOf = (path: string, count: number): string => (partsOf.get(path) ?? []).slice(-count).join('/')
  return new Map(
    paths.map(path => {
      const most = partsOf.get(path)?.length ?? 1
      let count = 1
      while (count < most && paths.some(other => other !== path && endOf(other, count) === endOf(path, count))) count += 1
      return [path, endOf(path, count)]
    }),
  )
}

/**
 * How far each file stands from the change: the changed files at 0, then,
 * role by role, the files linked to those already placed, a step at a time.
 */
function depthsOf(files: Array<Pick<MapFile, 'path' | 'role'>>, links: FileLink[]): Map<string, number> {
  const changed = files.filter(file => file.role === 'changed').map(file => file.path)
  const depths = new Map(changed.map(path => [path, 0]))
  for (const role of ['dependent', 'dependency'] as const) {
    let reached = changed
    for (let depth = 1; reached.length > 0; depth += 1) {
      const next = files
        .filter(file => file.role === role && !depths.has(file.path))
        .filter(file =>
          links.some(link =>
            role === 'dependent'
              ? link.from === file.path && reached.includes(link.to)
              : link.to === file.path && reached.includes(link.from),
          ),
        )
        .map(file => file.path)
      for (const path of next) depths.set(path, depth)
      reached = next
    }
  }
  return depths
}

/** The map by file, the files in the order the map first names them. */
export function filesOf(report: RippleReport): FileMap {
  const symbolsOf = new Map<string, RippleNode[]>()
  for (const node of report.nodes) symbolsOf.set(node.file, [...(symbolsOf.get(node.file) ?? []), node])
  const pathOf = new Map(report.nodes.map(node => [node.id, node.file]))

  const links: FileLink[] = []
  for (const edge of report.edges) {
    const from = pathOf.get(edge.from)
    const to = pathOf.get(edge.to)
    if (from === undefined || to === undefined || from === to) continue
    if (!links.some(link => link.from === from && link.to === to)) links.push({ from, to })
  }

  const names = namesOf([...symbolsOf.keys()])
  const placed = [...symbolsOf].map(([path, symbols]) => ({
    path,
    role: ROLES.find(role => symbols.some(symbol => symbol.role === role)) ?? 'dependent',
    symbols: [...symbols].sort((a, b) => a.line - b.line),
  }))
  const depths = depthsOf(placed, links)
  const files = placed.map(file => ({
    ...file,
    name: names.get(file.path) ?? file.path,
    // A file no link ties to the change stands where the nearest of its symbols does.
    depth:
      depths.get(file.path) ??
      Math.min(...file.symbols.filter(symbol => symbol.role === file.role).map(symbol => symbol.depth)),
    risk: RISKS.find(risk => file.symbols.some(symbol => symbol.risk === risk)) ?? 'ok',
  }))
  return { files, links }
}

/** The file that holds symbol `id`. */
export function fileOf(map: FileMap, id: string | null): MapFile | undefined {
  return map.files.find(file => file.symbols.some(symbol => symbol.id === id))
}

/** The symbol selected when `file` is: the selected one while it is in the file, else the file's first. */
export function symbolIn(file: MapFile, selected: string | null): RippleNode | undefined {
  return file.symbols.find(symbol => symbol.id === selected) ?? file.symbols[0]
}

/** Whether `from` uses `to`. */
export function isLinked(map: FileMap, from: MapFile, to: MapFile): boolean {
  return map.links.some(link => link.from === from.path && link.to === to.path)
}
