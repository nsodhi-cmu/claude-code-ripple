import type { RippleScope } from '../types'

// The changes Ripple maps, as git reports them: register.tsx runs the
// commands these functions name and hands back what they printed.

/** What `/ripple <args>` asks for. */
export type Request = { verb: 'map'; scope: RippleScope; focus: string } | { verb: 'reset' }

/** `reset` stands alone, `branch` picks the scope, and any other words are what to focus on. */
export function readRequest(args: string): Request {
  const words = args.trim().split(/\s+/).filter(word => word !== '')
  const [first = '', ...rest] = words
  const verb = first.toLowerCase()
  if (rest.length === 0 && verb === 'reset') return { verb }
  if (verb === 'branch') return { verb: 'map', scope: 'branch', focus: rest.join(' ') }
  return { verb: 'map', scope: 'uncommitted', focus: words.join(' ') }
}

const GIT = ['git', '-c', 'core.quotePath=false'] as const
/** Everything under the directory the command runs in. */
const PATHS = ['--', '.'] as const
/** The most untracked files whose contents are part of a print. */
const HASHED_FILES = 200

/**
 * The working tree against `ref`, one hunk per change and no context lines,
 * spelled so that nothing in the person's git configuration changes its shape.
 */
export function diffCommand(ref: string): string[] {
  return [
    ...GIT,
    'diff',
    ref,
    '--relative',
    '--unified=0',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    ...PATHS,
  ]
}

/** The files git does not track yet, which no diff shows. */
export const UNTRACKED_COMMAND: readonly string[] = [...GIT, 'ls-files', '--others', '--exclude-standard', ...PATHS]

/** What the untracked files hold, one hash a file, since their names alone do not say when one is edited. */
export function hashCommand(untracked: string): string[] | undefined {
  const files = untracked.split('\n').filter(line => line.trim() !== '')
  return files.length === 0 ? undefined : ['git', 'hash-object', '--', ...files.slice(0, HASHED_FILES).map(pathOf)]
}

/** Where the default branch is looked for, first hit wins. */
export const DEFAULT_BRANCH_COMMANDS: ReadonlyArray<readonly string[]> = [
  ['git', 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
  ['git', 'rev-parse', '--verify', '--quiet', '--abbrev-ref', 'main'],
  ['git', 'rev-parse', '--verify', '--quiet', '--abbrev-ref', 'master'],
]

/** The commit the current branch left `branch` at. */
export function mergeBaseCommand(branch: string): string[] {
  return ['git', 'merge-base', 'HEAD', branch]
}

export type ChangedFile = {
  /** Relative to the project root, forward slashes. */
  file: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  /** How many separate places the diff touches it; 0 for a file git does not track yet. */
  hunks: number
  /** The old path of a renamed file. */
  from?: string
}

/** What a scope's changes are against: `ref` as git is asked for it, `name` as the person would say it. */
export type Base = { ref: string; name: string }

export const HEAD: Base = { ref: 'HEAD', name: 'HEAD' }

export type Changes = {
  scope: RippleScope
  base: Base
  files: ChangedFile[]
  /** Two readings with one print hold the same changes. */
  print: string
}

function pathOf(value: string): string {
  return value.trim().replace(/^"|"$/g, '')
}

function withoutPrefix(path: string): string {
  return path.replace(/^[ab]\//, '')
}

/** Reads `git diff --unified=0` into one entry per file. */
function diffFiles(diff: string): ChangedFile[] {
  const files: ChangedFile[] = []
  let current: ChangedFile | undefined
  let isHeader = false
  for (const raw of diff.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('diff --git ')) {
      const same = /^diff --git a\/(.+) b\/\1$/.exec(line)
      current = { file: pathOf(same?.[1] ?? ''), status: 'modified', hunks: 0 }
      files.push(current)
      isHeader = true
    } else if (current === undefined) {
      continue
    } else if (line.startsWith('@@ ')) {
      current.hunks += 1
      isHeader = false
    } else if (!isHeader) {
      continue
    } else if (line.startsWith('new file mode')) {
      current.status = 'added'
    } else if (line.startsWith('deleted file mode')) {
      current.status = 'deleted'
    } else if (line.startsWith('rename from ')) {
      current.status = 'renamed'
      current.from = pathOf(line.slice('rename from '.length))
    } else if (line.startsWith('rename to ')) {
      current.file = pathOf(line.slice('rename to '.length))
    } else if (line.startsWith('+++ ') && !line.endsWith('/dev/null')) {
      current.file = withoutPrefix(pathOf(line.slice(4)))
    } else if (line.startsWith('--- ') && !line.endsWith('/dev/null') && current.file === '') {
      current.file = withoutPrefix(pathOf(line.slice(4)))
    }
  }
  return files.filter(entry => entry.file !== '')
}

function untrackedFiles(listing: string): ChangedFile[] {
  return listing
    .split('\n')
    .map(pathOf)
    .filter(file => file !== '')
    .map(file => ({ file, status: 'added' as const, hunks: 0 }))
}

/** A short print of some text: two texts with one print are taken as the same. */
export function printOf(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`
}

/**
 * The changes of a scope, from what git printed: the diff, the listing of
 * untracked files, and the hashes of what those files hold.
 */
export function readChanges(scope: RippleScope, base: Base, diff: string, untracked: string, hashes = ''): Changes {
  const files = [...diffFiles(diff), ...untrackedFiles(untracked)]
  return { scope, base, files, print: printOf([scope, diff, untracked, hashes].join('\n')) }
}

/** `2 files changed on this branch since main`, `1 uncommitted file`. */
export function describeChanges(changes: Changes): string {
  const count = changes.files.length
  const files = `file${count === 1 ? '' : 's'}`
  return changes.scope === 'branch'
    ? `${count} ${files} changed on this branch since ${changes.base.name}`
    : `${count} uncommitted ${files}`
}
