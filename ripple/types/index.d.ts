/** One function in the map. This is also one item of the report tool's `nodes`. */
export type RippleNode = {
  /** Unique within the map: "path/file.ts:name". */
  id: string
  name: string
  /** Relative to the project root, forward slashes. */
  file: string
  /** 1-based: a changed function's definition, a caller's call site. */
  line: number
  kind: 'changed' | 'caller' | 'callee'
  /** 0 changed, 1 direct caller or callee, 2 caller of a caller. */
  depth: number
  /** Changed nodes only. */
  change?: 'signature' | 'behavior' | 'added' | 'removed'
  status: 'ok' | 'needs-review' | 'updated'
  /** Referenced from any test file. */
  tested: boolean
  /** One line; present when the node needs review. */
  reason?: string
  /** Unresolved production issues Sentry has in this function, when Sentry MCP was asked. */
  sentry?: { count: number; issue?: string; title?: string }
}

/** `from` calls `to`. */
export type RippleEdge = { from: string; to: string }

/** What Claude reports and Ripple draws. */
export type RippleMap = {
  /** What the mapping mainly relied on, which says how far to trust it. */
  method: 'lsp' | 'tooling' | 'grep'
  nodes: RippleNode[]
  edges: RippleEdge[]
  /** Set on the canned `/ripple demo` map, which is never persisted. */
  isDemo?: boolean
}

/** One edit Claude made since the last map. */
export type RippleEdit = {
  file: string
  /** The first 400 characters of the new text. */
  snippet: string
  /** 1-based line of the first changed line, when the tool's patch says. */
  line?: number
  /** Milliseconds since the epoch. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    ripple: {
      edits: RippleEdit[]
      map: RippleMap | null
      mapping: boolean
    }
  }
}
