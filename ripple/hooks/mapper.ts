import type { RippleMap, RippleNode, RippleReport } from '../types'
import type { ChangedFile, Changes } from './changes'
import { MAX_NODES, REPORT_TOOL, countsOf, neighborsOf, plural } from './map'

// The mapper: the background agent that reads a change and reports its map,
// and every word Ripple says to a model. Nothing here touches `$`.

export const MAPPER_NAME = 'mapper'
/** The agent type as the engine names it: the plugin, then the agent. */
export const MAPPER_TYPE = `ripple:${MAPPER_NAME}`
export const MAPPER_DESCRIPTION = 'Maps what a code change reaches. Only Ripple starts it.'
/** Reading, searching, and reporting: the mapper has nothing to edit with. */
export const MAPPER_TOOLS: readonly string[] = ['Read', 'Bash', 'LSP', REPORT_TOOL]

/** What the mapper reads when a command of its would have needed the person's permission. */
export const NO_ASKING =
  'Ripple maps read-only and never asks the person for permission. Find it another way: read the files, or search them.'

/** The mapper's whole system prompt. */
export const MAPPER_PROMPT = `You are Ripple's mapper. Ripple is a Claude Code mod that draws the impact map of a code change: every symbol the change touches, everything that depends on those symbols, and which of those dependents the change puts at risk. You find that map and report it with the ${REPORT_TOOL} tool. Ripple draws it for the person, who is deciding whether the change is safe. You never talk to them.

You work read-only. Do not edit, create, or delete files, and do not run anything that changes the repository or installs something. A command that would need the person's permission is refused; when that happens, move on to the next method instead of retrying it.

# 1. Read the change

Run the diff command the task gives you and read the diff. List every symbol it touches: functions and methods, and also types (classes, structs, enums, interfaces, traits, type aliases), their fields and variants, constants, and exported variables. For each one decide what changed:
- signature: its parameters, return type, fields, variants, or type changed, so whatever uses it has to change with it
- behavior: the same shape, a different result or side effect
- renamed, added, or removed

Leave out what cannot reach other code: comments, formatting, documentation, and edits inside tests.

# 2. Find what depends on it

A dependent is any symbol that uses a changed one: it calls it, constructs it, matches on it, implements or extends it, reads the field or the constant, or re-exports it. Follow dependents outward for up to three steps (the dependents of dependents), and stop early on a path where the change clearly goes no further.

Also list what each changed symbol itself uses, one step only: its dependencies. They are context, so list the project's own symbols and leave out the standard library and third-party packages.

Use the most precise method that works in this repository, in this order, and report the one you mainly relied on:
a. lsp: the LSP tool. findReferences on each changed symbol, prepareCallHierarchy then incomingCalls and outgoingCalls for functions, goToImplementation for interfaces and traits.
b. tooling: the language's own checker, when it is allowed to run. After a signature change its errors point straight at what breaks.
c. grep: search for the name with rg or grep, then open every hit and discard comments, strings, and unrelated symbols that share the name.

If a method errors or finds nothing, fall back to the next. Never repeat a failing call more than twice. Keep it quick: a small change needs a handful of tool calls, not a survey of the repository.

# 3. Judge every dependent

Open each dependent where it uses the changed symbol and read enough to judge it:
- breaks: it no longer compiles, type-checks, or runs correctly as written. It passes the wrong arguments, misses a new field or variant, or uses a symbol that is gone.
- review: it still runs but may now do something different or wrong. It relies on the old return value, default, ordering, units, or error behavior; or the change weakens a safety check on the path to it: validation, authentication, authorization, escaping, secret handling, or a limit.
- ok: the change does not affect it.

Judge each dependent by its own code. One whose only trouble is that something it uses breaks is ok: fixing that other symbol fixes it.

Give every breaks and every review one line that says exactly what is wrong in terms of this code, such as "passes 1 argument; formatPrice now takes 2". Start the line with "security:" when it is a safety concern. Mark a symbol tested when any test file references it.

# 4. Report

Call ${REPORT_TOOL} exactly once.
- nodes: one per symbol. id is "<file>:<name>". name is the symbol as the code writes it, a member as Type.method or Type::method. kind is what the language calls it, lowercase. file is relative to the project root. line is 1-based: where a changed symbol or a dependency is defined, and where a dependent first uses what changed.
- role is changed, dependent, or dependency. Set change on changed symbols only, with a reason that says in one line what changed. Set risk on dependents; everything else is ok.
- edges: one per use, from the id of the symbol that uses to the id of the symbol it uses. Every dependent needs an edge to what it uses, and every dependency an edge from the changed symbol that uses it.
- At most ${MAX_NODES} nodes. If you must cut, keep the changed symbols, then what breaks, then what needs review, then the nearest dependents.
- summary: what this change puts at risk, in one or two short plain sentences, for someone deciding whether it is safe to ship. The reasons carry the detail.
- If the diff touches no symbol that other code could use, report empty nodes and edges and say so in the summary.

After the tool answers, reply with one short sentence and stop.`

type Language = { name: string; extensions: readonly string[]; notes: string }

/** What to watch for in the languages Ripple knows well; any other language gets the general method. */
const LANGUAGES: readonly Language[] = [
  {
    name: 'TypeScript and JavaScript',
    extensions: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'],
    notes:
      'Follow re-exports (index and barrel files, `export * from`) through to the real users. Types are structural: a changed interface or type alias breaks every object literal and every implementation of that shape, not only the code that names it. A default export or `import * as x` hides the name from a text search, so search for the module path too. Look for dynamic use: `obj[name]`, JSON keys, and string-keyed events. Checker: `npx tsc --noEmit`, or the typecheck script in package.json. Tests are `*.test.*`, `*.spec.*`, or under `__tests__/`.',
  },
  {
    name: 'Python',
    extensions: ['py', 'pyi'],
    notes:
      'Nothing checks a call before it runs, so read each call site: positional against keyword arguments, defaults, `*args` and `**kwargs` passed through, and decorators that wrap the changed function. Follow `from x import y as z` aliases, `__init__.py` re-exports, and `__all__`. Subclasses override methods and call `super()`. Duck-typed callers, `getattr`, and string dispatch never show up as references. Checker: `pyright` or `mypy`, when the repository configures one. Tests are `test_*.py` or `*_test.py`.',
  },
  {
    name: 'Rust',
    extensions: ['rs'],
    notes:
      'A changed trait breaks every `impl` of it, a changed struct breaks its literals and patterns, and a new enum variant breaks every `match` without a wildcard arm. Follow `pub use` re-exports, and look inside macros and `#[derive]`d impls, which a text search and the language server can both miss. Visibility bounds the search: a private item is used only in its module, a `pub(crate)` one only in its crate. Checker: `cargo check --all-targets --message-format short`. Tests are `#[cfg(test)]` modules and the files under `tests/`.',
  },
  {
    name: 'Go',
    extensions: ['go'],
    notes:
      'Interfaces are satisfied implicitly, so a changed method set breaks types and callers that never name the interface: trust the compiler over a search by name. A new struct field breaks unkeyed literals. A capitalized name can be used from any package in the module, an uncapitalized one only inside its own package. Checker: `go build ./...` and `go vet ./...`. Tests are `*_test.go`.',
  },
]

/** The notes for the languages these files are written in, in the order above. */
export function languageNotes(files: readonly ChangedFile[]): string[] {
  const extensions = new Set(files.map(entry => entry.file.split('.').pop()?.toLowerCase() ?? ''))
  return LANGUAGES.filter(language => language.extensions.some(extension => extensions.has(extension))).map(
    language => `${language.name}: ${language.notes}`,
  )
}

/** The most files a task lists; past this the mapper reads the rest off the diff. */
const LISTED_FILES = 60

function fileLine(entry: ChangedFile): string {
  if (entry.status === 'renamed') return `- ${entry.file} (renamed from ${entry.from ?? 'another path'})`
  if (entry.status === 'deleted') return `- ${entry.file} (deleted)`
  if (entry.status === 'added') return `- ${entry.file} (new${entry.hunks === 0 ? ', not in the diff: read the file' : ''})`
  return `- ${entry.file} (${plural(entry.hunks, 'hunk')})`
}

/** What one mapping asks of the mapper: which changes, how to read them, and what to look at. */
export function taskPrompt(changes: Changes, focus: string): string {
  const lines = [
    changes.scope === 'branch'
      ? `Map what this branch changed since it left ${changes.base.name}, uncommitted changes included.`
      : 'Map the uncommitted changes in this repository.',
    `Read them with \`git diff ${changes.base.ref}\`.`,
    '',
    'Changed files:',
    ...changes.files.slice(0, LISTED_FILES).map(fileLine),
  ]
  if (changes.files.length > LISTED_FILES) {
    lines.push(`- and ${plural(changes.files.length - LISTED_FILES, 'more file')}`)
  }
  if (focus !== '') {
    lines.push(
      '',
      `Focus: ${focus}`,
      'Map only what bears on this focus and leave the rest of the change out. If it names a symbol, map that symbol and what depends on it. If it asks a question, map what answers it and answer it in the summary.',
    )
  }
  const notes = languageNotes(changes.files)
  if (notes.length > 0) lines.push('', 'Notes for the languages in this change:', ...notes.map(note => `- ${note}`))
  return lines.join('\n')
}

/** The report tool's answer to the mapper. */
export function reportReply(report: RippleReport, notes: readonly string[]): string {
  const counts = countsOf(report)
  const drawn =
    report.nodes.length === 0
      ? 'Ripple told the person the changes touch no symbol other code uses.'
      : `Ripple drew the map: ${counts.changed} changed, ${plural(counts.dependents, 'dependent')}, ${counts.breaks} breaking, ${counts.review} to review.`
  const adjusted = notes.length === 0 ? '' : ` Ripple adjusted it: ${notes.join('; ')}.`
  return `${drawn}${adjusted} Reply with one short sentence and stop.`
}

function located(node: RippleNode): string {
  return node.line > 0 ? `${node.name} at ${node.file}:${node.line}` : `${node.name} in ${node.file}`
}

/**
 * What asking Claude about a node submits. The conversation never saw the
 * map, so the prompt carries what Ripple knows, and asks for no edits.
 */
export function askPrompt(node: RippleNode, map: RippleMap): string {
  const changes = map.scope === 'branch' ? `this branch's changes since ${map.base}` : 'my uncommitted changes'
  const changed = map.nodes.filter(other => other.role === 'changed')
  const lines = [`Ripple mapped ${changes}. Look at ${located(node)} (${node.kind}).`]
  if (node.role === 'changed') {
    const { usedBy } = neighborsOf(map, node.id)
    lines.push(`It changed${node.reason === undefined ? '' : `: ${node.reason}`}.`)
    if (usedBy.length > 0) lines.push(`It is used by ${usedBy.map(other => other.name).join(', ')}.`)
    lines.push('Explain what the change does to the code that uses it.')
  } else {
    if (changed.length > 0) lines.push(`The changed symbols are ${changed.map(located).join(', ')}.`)
    if (node.risk !== 'ok') {
      const verdict = node.risk === 'breaks' ? 'the change breaks it' : 'it may now behave differently'
      lines.push(`Ripple's mapper judged that ${verdict}${node.reason === undefined ? '' : `: ${node.reason}`}.`)
    }
    lines.push('Check whether the change really affects it, and say what you find and what the fix would be.')
  }
  lines.push('Do not edit any files.')
  return lines.join('\n')
}
