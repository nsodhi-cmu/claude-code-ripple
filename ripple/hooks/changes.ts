// The changes Ripple maps, as git reports them. Nothing here touches `$`:
// register.tsx runs the commands these functions name and hands back the text.

/** Which changes: the working tree against HEAD, or everything since the branch left the default one. */
export type Scope = 'uncommitted' | 'branch'

/** What `/ripple <args>` asks for. */
export type Request = { verb: 'map'; scope: Scope; focus: string } | { verb: 'web' | 'reset' }

/** `web` and `reset` stand alone, `branch` picks the scope, and any other words are what to focus on. */
export function readRequest(args: string): Request {
  const words = args.trim().split(/\s+/).filter(word => word !== '')
  const [first = '', ...rest] = words
  const verb = first.toLowerCase()
  if (rest.length === 0 && (verb === 'web' || verb === 'reset')) return { verb }
  if (verb === 'branch') return { verb: 'map', scope: 'branch', focus: rest.join(' ') }
  return { verb: 'map', scope: 'uncommitted', focus: words.join(' ') }
}

const GIT = ['git', '-c', 'core.quotePath=false'] as const

/** The working tree against `base`, one hunk per change and no context lines. */
export function diffCommand(base: string): string[] {
  return [...GIT, 'diff', base, '--relative', '--unified=0', '--no-color', '--no-ext-diff']
}

/** The files git does not track yet, which no diff shows. */
export const UNTRACKED_COMMAND: readonly string[] = [...GIT, 'ls-files', '--others', '--exclude-standard']

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

export type Changes = {
  scope: Scope
  /** What the diff is against, as the person would name it: `HEAD`, `main`. */
  base: string
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

/** What `/ripple web` writes into a project is never a change to map. */
const OWN_OUTPUT = '.ripple/'

function untrackedFiles(listing: string): ChangedFile[] {
  return listing
    .split('\n')
    .map(pathOf)
    .filter(file => file !== '' && !file.startsWith(OWN_OUTPUT))
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

/** The changes of a scope, from the text of its diff and the listing of untracked files. */
export function readChanges(scope: Scope, base: string, diff: string, untracked: string): Changes {
  const files = [...diffFiles(diff), ...untrackedFiles(untracked)]
  return { scope, base, files, print: printOf(`${scope}\n${diff}\n${untracked}`) }
}

/** `2 files on this branch since main`, `1 uncommitted file`. */
export function describeChanges(changes: Changes): string {
  const count = changes.files.length
  const files = `file${count === 1 ? '' : 's'}`
  return changes.scope === 'branch'
    ? `${count} ${files} changed on this branch since ${changes.base}`
    : `${count} uncommitted ${files}`
}
