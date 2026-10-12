/** One symbol in the map: a function, a type, a constant, whatever the language has. */
export type RippleNode = {
  /** Unique within the map: "path/file.ts:name". */
  id: string
  name: string
  /** What the language calls it, lowercase: "function", "struct", "trait", "const". */
  kind: string
  /** Relative to the project root, forward slashes. */
  file: string
  /** 1-based: where a changed symbol or a dependency is defined, where a dependent uses what changed. */
  line: number
  /** `changed` is in the diff, a `dependent` uses a changed symbol, a `dependency` is used by one. */
  role: 'changed' | 'dependent' | 'dependency'
  /** Steps from the nearest changed symbol; 0 for a changed one. */
  depth: number
  /** Changed symbols only. */
  change?: 'signature' | 'behavior' | 'renamed' | 'added' | 'removed'
  /**
   * `breaks` will not compile or run as written, `review` may now behave
   * differently, `ok` is unaffected. A dependency is always `ok`.
   */
  risk: 'ok' | 'review' | 'breaks'
  /** Referenced from any test file. */
  isTested: boolean
  /** One line: why the node is at risk, or what changed about a changed symbol. */
  reason?: string
}

/** `from` uses `to`: calls it, constructs it, implements it, reads it. */
export type RippleEdge = { from: string; to: string }

/** What the mapper reports. */
export type RippleReport = {
  /** What the mapping mainly relied on, which says how far to trust it. */
  method: 'lsp' | 'tooling' | 'grep'
  nodes: RippleNode[]
  edges: RippleEdge[]
  /** The mapper's own words on what the change puts at risk. */
  summary?: string
}

/** Which changes: the working tree against HEAD, or everything since the branch left the default one. */
export type RippleScope = 'uncommitted' | 'branch'

/** The changes a mapping is of. */
export type RippleOrigin = {
  scope: RippleScope
  /** What the changes are against, as the person would name it: `HEAD`, `main`. */
  base: string
  /** What the person asked the map to look at; empty for everything. */
  focus: string
  /** The print of the changes; the same changes need no new map. */
  print: string
}

/** What Ripple draws: a report, and the changes it is of. */
export type RippleMap = RippleReport & RippleOrigin

export type RippleMode = 'graph' | 'tree'

/**
 * What the person is looking at: which view, and the id of the node selected
 * in it. `mode` is null until they switch views: until then the plugin's
 * `view` option decides.
 */
export type RippleView = { mode: RippleMode | null; selected: string | null }

declare module 'claude-code' {
  interface PluginState {
    ripple: {
      map: RippleMap | null
      /** The mapper at work and what it was sent to map; null when none is. */
      mapping: (RippleOrigin & { agentId: string }) | null
      view: RippleView
    }
  }
}
