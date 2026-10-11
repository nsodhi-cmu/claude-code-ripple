import type { RippleEdit, RippleEdge, RippleMap, RippleNode } from '../types'

// Pure functions over Ripple's data: nothing here touches `$`, so all of it is
// unit-tested directly (model.test.ts).

export const MAX_NODES = 40
export const SNIPPET_CHARS = 400
/** A change this close to a node's line counts as touching the node. */
export const TOUCH_LINES = 15
export const REPORT_TOOL = 'mcp__ripple__report'
/** Opens every mapping prompt; `turn.start` knows the mapping turn by it. */
export const MAPPING_MARKER = '[Ripple] Map what the changes below reach.'

const METHODS = ['lsp', 'tooling', 'grep'] as const
const KINDS = ['changed', 'caller', 'callee'] as const
const STATUSES = ['ok', 'needs-review', 'updated'] as const
const CHANGES = ['signature', 'behavior', 'added', 'removed'] as const

const METHOD_LABEL: Record<RippleMap['method'], string> = {
  lsp: 'LSP',
  tooling: 'type checker',
  grep: 'text search',
}

export const REPORT_DESCRIPTION =
  'Ripple: submit the impact map of the uncommitted changes. Call exactly once, only when Ripple asks you to map.'

/** The report tool's input schema: RippleMap, as JSON Schema. */
export const REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['method', 'nodes', 'edges'],
  properties: {
    method: {
      type: 'string',
      enum: [...METHODS],
      description: 'What you mainly relied on to find callers.',
    },
    nodes: {
      type: 'array',
      maxItems: MAX_NODES,
      description: 'One per function: the changed ones, their callers and their callees.',
      items: {
        type: 'object',
        required: ['id', 'name', 'file', 'line', 'kind', 'depth', 'status', 'tested'],
        properties: {
          id: { type: 'string', description: 'Unique: "path/file.ts:name".' },
          name: { type: 'string', description: 'The function or method name.' },
          file: { type: 'string', description: 'Path relative to the project root.' },
          line: {
            type: 'integer',
            description:
              '1-based. A changed function or callee: where it is defined. A caller: where it makes the call.',
          },
          kind: { type: 'string', enum: [...KINDS] },
          depth: {
            type: 'integer',
            minimum: 0,
            maximum: 2,
            description: '0 changed, 1 direct caller or callee, 2 caller of a caller.',
          },
          change: {
            type: 'string',
            enum: [...CHANGES],
            description: 'Changed nodes only: what about the function changed.',
          },
          status: {
            type: 'string',
            enum: [...STATUSES],
            description: 'needs-review when the change may break it or alter what it does.',
          },
          tested: { type: 'boolean', description: 'True when any test file references it.' },
          reason: { type: 'string', description: 'One line. Required when status is needs-review.' },
        },
      },
    },
    edges: {
      type: 'array',
      description: 'One per call: `from` calls `to`, both node ids.',
      items: {
        type: 'object',
        required: ['from', 'to'],
        properties: { from: { type: 'string' }, to: { type: 'string' } },
      },
    },
  },
}

// ---------------------------------------------------------------- small helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function int(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find(option => option === value)
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

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// ------------------------------------------------------------------------ paths

export function slash(path: string): string {
  return path.replace(/\\/g, '/')
}

function comparable(path: string): string {
  return slash(path)
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * Whether two spellings name one file. Claude reports paths relative to the
 * project and tools carry absolute ones, so a match on a path boundary counts.
 */
export function sameFile(a: string, b: string): boolean {
  const left = comparable(a)
  const right = comparable(b)
  if (left === '' || right === '') return false
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}

// ---------------------------------------------------------------------- touches

type Span = readonly [start: number, end: number]

/** What one hunk of the diff changed, as the "did it touch this node" test reads it. */
export type EditTouch = { file: string; text: string; spans: Span[] }

/** The touch of one diff hunk: its added text, and the lines it now covers. */
export function touchOf(hunk: RippleEdit): EditTouch {
  const start = hunk.line ?? 1
  const height = hunk.snippet === '' ? 1 : hunk.snippet.split('\n').length
  return { file: hunk.file, text: hunk.snippet, spans: [[start, start + height - 1]] }
}

/** Names a hunk by its file and text, not its line: a hunk pushed down the file is the same hunk. */
export function hunkKey(hunk: RippleEdit): string {
  return printOf(`${comparable(hunk.file)}\n${hunk.snippet}`)
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char)
}

function hasWord(haystack: string, word: string): boolean {
  if (word === '') return false
  let at = haystack.indexOf(word)
  while (at !== -1) {
    const before = at === 0 ? undefined : haystack[at - 1]
    const after = haystack[at + word.length]
    if (!isWordChar(before) && !isWordChar(after)) return true
    at = haystack.indexOf(word, at + 1)
  }
  return false
}

/** `Cart.render` and `cart::render` are both written `render` at the edit. */
function leafName(name: string): string {
  return name.split(/::|[.#]/).pop() ?? name
}

/** Same file, and the edit names the node or lands within TOUCH_LINES of it. */
export function touches(node: RippleNode, touch: EditTouch): boolean {
  if (!sameFile(node.file, touch.file)) return false
  if (hasWord(touch.text, leafName(node.name))) return true
  return touch.spans.some(
    ([start, end]) => node.line >= start - TOUCH_LINES && node.line <= end + TOUCH_LINES,
  )
}

/** Turns every needs-review node the edit touched to `updated`. */
export function markUpdated(
  map: RippleMap,
  touch: EditTouch,
): { map: RippleMap; updated: RippleNode[] } {
  const updated: RippleNode[] = []
  const nodes = map.nodes.map(node => {
    if (node.status !== 'needs-review' || !touches(node, touch)) return node
    const turned: RippleNode = { ...node, status: 'updated' }
    updated.push(turned)
    return turned
  })
  return updated.length === 0 ? { map, updated } : { map: { ...map, nodes }, updated }
}

// ------------------------------------------------------------- reading the map

export type Counts = {
  changed: number
  callers: number
  callees: number
  review: number
  updated: number
}

export function countsOf(map: RippleMap): Counts {
  const counts: Counts = { changed: 0, callers: 0, callees: 0, review: 0, updated: 0 }
  for (const node of map.nodes) {
    if (node.kind === 'changed') counts.changed += 1
    else if (node.kind === 'caller') counts.callers += 1
    else counts.callees += 1
    if (node.status === 'needs-review') counts.review += 1
    else if (node.status === 'updated') counts.updated += 1
  }
  return counts
}

export function needsReview(map: RippleMap): RippleNode[] {
  return map.nodes.filter(node => node.status === 'needs-review')
}

/** `Ripple · 1 change → 7 callers · 3 need review · via LSP` */
export function headerText(map: RippleMap): string {
  if (map.nodes.length === 0) return 'Ripple · no function changes found'
  const counts = countsOf(map)
  const parts = [`Ripple · ${plural(counts.changed, 'change')} → ${plural(counts.callers, 'caller')}`]
  if (counts.review > 0) parts.push(`${counts.review} need${counts.review === 1 ? 's' : ''} review`)
  else parts.push(counts.updated > 0 ? 'all reviewed' : 'nothing to review')
  parts.push(`via ${METHOD_LABEL[map.method]}`)
  if (map.isDemo === true) parts.push('demo')
  return parts.join(' · ')
}

/**
 * The status line under the prompt, or undefined when there is nothing to say.
 * `unmapped` is how many files hold uncommitted changes the map on hand was
 * not made from: what /ripple would map now.
 */
export function statusText(map: RippleMap | null, mapping: boolean, unmapped: number): string | undefined {
  if (mapping) return 'ripple: mapping…'
  const parts: string[] = []
  const review = map === null || map.isDemo === true ? 0 : countsOf(map).review
  if (review > 0) parts.push(`${review} need${review === 1 ? 's' : ''} review`)
  if (unmapped > 0) parts.push(`uncommitted changes in ${plural(unmapped, 'file')} · /ripple to map`)
  else if (review > 0) parts.push('/ripple to see the map')
  return parts.length === 0 ? undefined : `ripple: ${parts.join(' · ')}`
}

// ------------------------------------------------------------------ git diffs

/** The most hunks of a diff that are kept; a larger diff is listed by file anyway. */
const MAX_HUNKS = 600

/**
 * Reads `git diff --unified=0` into one edit per hunk: the file, the first new
 * line, and the added text. This is how a change nobody made through Claude's
 * Edit tool (yours, a script's, a merge's) reaches the map.
 */
export function parseDiff(diff: string, at: number): RippleEdit[] {
  const edits: RippleEdit[] = []
  let file = ''
  let before = ''
  let isHeader = false
  let hunk: { line: number; added: string[] } | undefined
  const flush = (): void => {
    if (hunk !== undefined && file !== '' && edits.length < MAX_HUNKS) {
      edits.push({ file, line: hunk.line, snippet: hunk.added.join('\n').slice(0, SNIPPET_CHARS), at })
    }
    hunk = undefined
  }
  const pathOf = (value: string): string =>
    value.trim().replace(/^"|"$/g, '').replace(/^[ab]\//, '')

  for (const raw of diff.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('diff --git ')) {
      flush()
      file = ''
      before = ''
      isHeader = true
    } else if (isHeader && line.startsWith('--- ')) {
      before = pathOf(line.slice(4))
    } else if (isHeader && line.startsWith('+++ ')) {
      const after = pathOf(line.slice(4))
      file = after === '/dev/null' || after === 'dev/null' ? before : after
    } else if (line.startsWith('@@ ')) {
      flush()
      isHeader = false
      const start = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line)
      hunk = { line: Math.max(1, Number(start?.[1] ?? 1)), added: [] }
    } else if (hunk !== undefined && line.startsWith('+')) {
      hunk.added.push(line.slice(1))
    }
  }
  flush()
  return edits
}

/** A short print of a diff's text: two diffs with one print are taken as the same change. */
export function printOf(diff: string): string {
  let hash = 5381
  for (let index = 0; index < diff.length; index += 1) {
    hash = ((hash << 5) + hash + diff.charCodeAt(index)) | 0
  }
  return `${diff.length}:${(hash >>> 0).toString(16)}`
}

export function fileCount(edits: RippleEdit[]): number {
  return new Set(edits.map(edit => comparable(edit.file))).size
}

/** The most new files listed; past this a prompt names files, not functions. */
const MAX_NEW_FILES = 40

/**
 * `git ls-files --others --exclude-standard` as hunks: a file git does not
 * track yet is a change too, though `git diff` never shows it.
 */
export function newFileHunks(listing: string, at: number): RippleEdit[] {
  return listing
    .split('\n')
    .map(line => slash(line.trim().replace(/^"|"$/g, '')))
    .filter(file => file !== '' && !file.startsWith('.ripple/'))
    .slice(0, MAX_NEW_FILES)
    .map(file => ({ file, line: 1, snippet: '(new file, not yet tracked by git)', at }))
}

/**
 * The map the store kept, read back with the print of the diff it was made
 * from; null when there is none or it no longer reads as a map.
 */
export function readStored(value: unknown): RippleMap | null {
  const kept = sanitizeMap(value)
  if ('error' in kept || kept.map.nodes.length === 0) return null
  const print = isRecord(value) && typeof value.print === 'string' ? value.print : undefined
  return print === undefined ? kept.map : { ...kept.map, print }
}

// -------------------------------------------------------------------- prompts

const LISTED_EDITS = 30

function firstLine(snippet: string): string {
  const line = snippet.split('\n').find(candidate => candidate.trim() !== '') ?? ''
  const flat = line.trim().replace(/`/g, "'")
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat
}

function editLine(edit: RippleEdit): string {
  const where = edit.line === undefined ? edit.file : `${edit.file}:${edit.line}`
  const shown = firstLine(edit.snippet)
  return shown === '' ? `- ${where}` : `- ${where}: \`${shown}\``
}

const LISTED_FILES = 60

/** Many edits, one line a file: how many changes, and where the first one is. */
function fileLines(edits: RippleEdit[]): string[] {
  const byFile = new Map<string, RippleEdit[]>()
  for (const edit of edits) byFile.set(edit.file, [...(byFile.get(edit.file) ?? []), edit])
  const lines: string[] = []
  for (const [file, group] of [...byFile].slice(0, LISTED_FILES)) {
    const [first] = group
    const shown = first === undefined ? '' : firstLine(first.snippet)
    const where = first?.line === undefined ? '' : `, first at line ${first.line}`
    lines.push(`- ${file} (${plural(group.length, 'change')}${where})${shown === '' ? '' : `: \`${shown}\``}`)
  }
  if (byFile.size > LISTED_FILES) lines.push(`- and ${plural(byFile.size - LISTED_FILES, 'more file')}`)
  return lines
}

/**
 * The prompt that asks Claude to map the working tree's uncommitted changes:
 * `hunks` is `git diff HEAD` as parseDiff read it, however the changes were made.
 */
export function mappingPrompt(hunks: RippleEdit[]): string {
  const lines = [
    `${MAPPING_MARKER} Ripple will draw your result for the user.`,
    'Do not edit any files while mapping, and do not ask the user anything: make your best call.',
    '',
    'Uncommitted changes in the working tree (from `git diff HEAD`; run it yourself to read the full text):',
  ]
  if (hunks.length > LISTED_EDITS) lines.push(...fileLines(hunks))
  else for (const hunk of hunks) lines.push(editLine(hunk))
  lines.push(
    '',
    '1. Identify every function or method these changes touched. For each, decide whether its',
    '   signature changed (parameters or return type), only its behavior changed, or it was',
    '   added or removed.',
    '',
    '2. Find the impact, up to depth 2:',
    '   - Callers: direct callers (depth 1) and their callers (depth 2).',
    '   - Callees: what each changed function calls (depth 1 only).',
    '   Use the most precise tool available, in this order:',
    '   a. The LSP tool: prepareCallHierarchy on each changed function, then incomingCalls and',
    "      outgoingCalls. Use findReferences if call hierarchy isn't supported.",
    "   b. The language's own checker: tsc --noEmit, cargo check, go vet, pyright, mypy, etc.",
    '      After a signature change its errors point straight at broken callers.',
    '   c. Text search (rg for the name followed by "("). Filter out comments, strings, and',
    '      unrelated symbols with the same name.',
    '   If a tool errors or returns nothing, fall back to the next one. Never retry the',
    '   same failing call more than twice. Keep it quick: for a small change a handful of',
    '   tool calls is enough.',
    '',
    '3. For each caller, set status "needs-review" if the change may break it or change what',
    '   it does (wrong argument count, relies on the old return value or old behavior, or has',
    '   a value at hand that the new parameter should now receive). Otherwise set "ok". Give a',
    '   one-line reason for every needs-review.',
    '',
    '4. Set tested = true if any test file references the node.',
    '',
    `5. Cap the map at ${MAX_NODES} nodes. If you must cut, keep needs-review and depth-1 nodes first.`,
    '',
    `6. Call ${REPORT_TOOL} exactly once with the map. Set method to the tool you`,
    '   mainly relied on (lsp, tooling, or grep). Then follow the instructions in its result.',
    '   - One node per function: id is "<file>:<name>", file is relative to the project root,',
    '     line is where a changed function or a callee is defined and where a caller makes',
    '     the call.',
    '   - kind is "changed" (depth 0), "caller" (depth 1 or 2) or "callee" (depth 1). Set',
    '     change on changed nodes only.',
    '   - One edge per call: from is the id of the caller, to the id of what it calls.',
    '   - If the changes touched no function at all, report empty nodes and edges.',
  )
  return lines.join('\n')
}

/** The report tool's result: what makes Claude go and check the callers. */
export function reportText(map: RippleMap, notes: string[] = []): string {
  if (map.nodes.length === 0) {
    return 'Ripple has nothing to draw: the changes touched no function. Tell the user so in one line.'
  }
  const counts = countsOf(map)
  const lines = [
    `Ripple map shown to the user: ${counts.changed} changed, ${plural(counts.callers, 'caller')}, ${counts.review} need review.`,
  ]
  const review = needsReview(map)
  if (review.length > 0) {
    lines.push('Needs review:')
    for (const node of review) {
      lines.push(
        `- ${node.name} (${node.file}:${node.line}): ${node.reason ?? 'may be affected by the change'}`,
      )
    }
    lines.push(
      "For each one: open it, check it against the change, and fix it if it's broken.",
      'Ripple turns a caller green once your fix to it is in the working tree. Then tell the user what you changed.',
    )
  } else {
    lines.push('Nothing needs review. Tell the user what you mapped and that no caller looks broken.')
  }
  if (notes.length > 0) lines.push(`(Ripple adjusted the map: ${notes.join('; ')}.)`)
  return lines.join('\n')
}

/** What a Check button submits. */
export function checkPrompt(node: RippleNode, map: RippleMap): string {
  const changed = map.nodes.filter(other => other.kind === 'changed').map(other => other.name)
  const target = changed.length > 0 ? changed.join(', ') : 'the recent edits'
  const why = node.reason === undefined ? '' : ` Ripple flagged it: ${node.reason}`
  return `Check ${node.name} at ${node.file}:${node.line} against the change to ${target}; fix it if needed.${why}`
}

// ----------------------------------------------------------------- sanitizing

function readNode(raw: unknown): RippleNode | undefined {
  if (!isRecord(raw)) return undefined
  const name = text(raw.name).slice(0, 80)
  const file = slash(text(raw.file)).slice(0, 300)
  if (name === '' || file === '') return undefined
  const kind = oneOf(KINDS, raw.kind) ?? (int(raw.depth, 1) === 0 ? 'changed' : 'caller')
  const depth = kind === 'changed' ? 0 : kind === 'callee' ? 1 : clamp(int(raw.depth, 1), 1, 2)
  const change = kind === 'changed' ? oneOf(CHANGES, raw.change) : undefined
  const reason = text(raw.reason).replace(/\s+/g, ' ').slice(0, 200)
  return {
    id: text(raw.id) || `${file}:${name}`,
    name,
    file,
    line: Math.max(0, int(raw.line, 0)),
    kind,
    depth,
    status: oneOf(STATUSES, raw.status) ?? 'ok',
    tested: raw.tested === true || raw.tested === 'true',
    ...(change === undefined ? {} : { change }),
    ...(reason === '' ? {} : { reason }),
  }
}

/** Past the cap: changed first, then needs-review, then depth 1; order kept. */
function capNodes(nodes: RippleNode[]): RippleNode[] {
  const rank = (node: RippleNode): number =>
    node.kind === 'changed' ? 0 : node.status === 'needs-review' ? 1 : node.depth <= 1 ? 2 : 3
  const kept = new Set(
    nodes
      .map((node, index) => ({ node, index }))
      .sort((a, b) => rank(a.node) - rank(b.node) || a.index - b.index)
      .slice(0, MAX_NODES)
      .map(entry => entry.node.id),
  )
  return nodes.filter(node => kept.has(node.id))
}

export type Sanitized = { map: RippleMap; notes: string[] } | { error: string }

/**
 * Reads what Claude reported into a RippleMap. Light on purpose: ids are made
 * unique, edges that name no node are dropped, and only a map that cannot be
 * read at all is an error.
 */
export function sanitizeMap(input: unknown): Sanitized {
  if (!isRecord(input)) return { error: 'the input is not an object.' }
  const rawNodes = list(input.nodes)
  if (rawNodes === undefined) return { error: '`nodes` must be an array.' }

  const notes: string[] = []
  const seen = new Set<string>()
  let nodes: RippleNode[] = []
  for (const raw of rawNodes) {
    const node = readNode(raw)
    if (node === undefined || seen.has(node.id)) continue
    seen.add(node.id)
    nodes.push(node)
  }
  if (rawNodes.length > 0 && nodes.length === 0) {
    return { error: 'no node had both a `name` and a `file`.' }
  }
  if (nodes.length < rawNodes.length) {
    notes.push(`dropped ${plural(rawNodes.length - nodes.length, 'node')} with a repeated id or no name`)
  }
  if (nodes.length > MAX_NODES) {
    notes.push(`kept ${MAX_NODES} of ${nodes.length} nodes`)
    nodes = capNodes(nodes)
  }

  const ids = new Set(nodes.map(node => node.id))
  const edges: RippleEdge[] = []
  const linked = new Set<string>()
  let dropped = 0
  for (const raw of list(input.edges) ?? []) {
    const from = isRecord(raw) ? text(raw.from) : ''
    const to = isRecord(raw) ? text(raw.to) : ''
    if (!ids.has(from) || !ids.has(to) || from === to) {
      dropped += 1
      continue
    }
    const key = `${from}\n${to}`
    if (linked.has(key)) continue
    linked.add(key)
    edges.push({ from, to })
  }
  if (dropped > 0) notes.push(`dropped ${plural(dropped, 'edge')} that named no node`)

  return { map: { method: oneOf(METHODS, input.method) ?? 'grep', nodes, edges }, notes }
}
