import type { EngineInterface } from 'claude-code'

import { markOf } from './draw'
import type { Paint } from './draw'
import type { FileMap } from './files'
import { rankOf } from './map'

// The map as a graph, which graphlet draws: a node a file, in layers along
// the flow of use, the files that use the change above it and the files it
// uses below.

/** A graph as graphlet takes one. */
export type Graph = Parameters<EngineInterface['graphlet']['show']>[0]['graph']

/** The narrowest room the map is drawn as a graph in, and the shortest; in less it is drawn as the tree. */
export const GRAPH_COLUMNS = 40
export const GRAPH_ROWS = 9

/** The tone graphlet paints each of the map's paints in. */
const TONES = {
  plain: 'plain',
  dim: 'dim',
  changed: 'note',
  breaks: 'bad',
  review: 'warn',
  accent: 'plain',
} as const satisfies Record<Paint, NonNullable<Graph['nodes'][number]['tone']>>

/**
 * The map's files as a graph: each a node under its path, saying its mark,
 * its name, and how many of the map's symbols it holds when more than one.
 * A file's layer is how far it stands from the change, the files that use the
 * change counted upward.
 */
export function graphOf(map: FileMap): Graph {
  return {
    nodes: map.files.map(file => {
      const mark = markOf(file)
      return {
        id: file.path,
        label: file.name,
        mark: mark.glyph,
        tone: TONES[mark.paint],
        ...(file.symbols.length > 1 ? { badge: String(file.symbols.length) } : {}),
        layer: rankOf(file),
      }
    }),
    links: map.links,
  }
}
