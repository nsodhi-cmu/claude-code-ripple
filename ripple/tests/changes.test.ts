import { describe, expect, test } from 'claude-code/testing'

import {
  HEAD,
  UNTRACKED_COMMAND,
  describeChanges,
  diffCommand,
  hashCommand,
  printOf,
  readChanges,
  readRequest,
} from '../hooks/changes'

// Git's own output for one working tree: a binary file, a removed line that
// reads like a header, a deleted file, a path with a space (git ends those
// with a tab), two hunks in one file, and a rename with nothing else changed.
const DIFF = [
  'diff --git a/logo.bin b/logo.bin',
  'index 8352675..1592e5c 100644',
  'Binary files a/logo.bin and b/logo.bin differ',
  'diff --git a/q.sql b/q.sql',
  'index 6fc90f3..ab290eb 100644',
  '--- a/q.sql',
  '+++ b/q.sql',
  '@@ -1 +0,0 @@',
  '--- a comment',
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  'index 3367afd..0000000',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-old',
  'diff --git a/src/my file.ts b/src/my file.ts',
  'index 814f4a4..879de50 100644',
  '--- a/src/my file.ts\t',
  '+++ b/src/my file.ts\t',
  '@@ -2 +2 @@ one',
  '-two',
  '+TWO',
  'diff --git a/src/price.ts b/src/price.ts',
  'index 18b7639..4aa2df2 100644',
  '--- a/src/price.ts',
  '+++ b/src/price.ts',
  '@@ -1,2 +1,2 @@',
  '-export function formatPrice(amount: number): string {',
  '-  return amount.toFixed(2)',
  '+export function formatPrice(amount: number, currency: string): string {',
  '+  return currency + amount.toFixed(2)',
  '@@ -5 +5 @@ export function formatPrice(amount: number): string {',
  '-export const TAX = 0.2',
  '+export const TAX = 0.25',
  'diff --git a/src/moved.ts b/src/renamed.ts',
  'similarity index 100%',
  'rename from src/moved.ts',
  'rename to src/renamed.ts',
  '',
].join('\n')

const MAIN = { ref: '4f1c2aa', name: 'main' }

const UNTRACKED = 'src/fresh.ts\nsrc/üni.ts\n'

describe('reading a diff', () => {
  const { files } = readChanges('uncommitted', HEAD, DIFF, UNTRACKED)
  const named = (file: string) => files.find(entry => entry.file === file)

  test('every file is one entry, in the order git lists them, untracked ones last', () => {
    expect(files.map(entry => entry.file)).toEqual([
      'logo.bin',
      'q.sql',
      'src/gone.ts',
      'src/my file.ts',
      'src/price.ts',
      'src/renamed.ts',
      'src/fresh.ts',
      'src/üni.ts',
    ])
  })

  test('hunks are counted per file, and a binary file has none', () => {
    expect(named('src/price.ts')).toEqual({ file: 'src/price.ts', status: 'modified', hunks: 2 })
    expect(named('logo.bin')).toEqual({ file: 'logo.bin', status: 'modified', hunks: 0 })
  })

  test('a removed line that reads like a file header does not rename the file', () => {
    expect(named('q.sql')).toEqual({ file: 'q.sql', status: 'modified', hunks: 1 })
    expect(named('a comment')).toBeUndefined()
  })

  test('a deleted file keeps its name and a renamed one carries its old path', () => {
    expect(named('src/gone.ts')?.status).toBe('deleted')
    expect(named('src/renamed.ts')).toEqual({
      file: 'src/renamed.ts',
      status: 'renamed',
      hunks: 0,
      from: 'src/moved.ts',
    })
  })

  test('a path with a space loses the tab git ends it with', () => {
    expect(named('src/my file.ts')?.hunks).toBe(1)
  })

  test('a file git does not track is an added file', () => {
    expect(named('src/fresh.ts')).toEqual({ file: 'src/fresh.ts', status: 'added', hunks: 0 })
  })
})

describe('what git is asked', () => {
  test('the diff is spelled so that no git configuration changes its shape', () => {
    const asked = diffCommand('4f1c2aa')
    expect(asked.slice(0, 5)).toEqual(['git', '-c', 'core.quotePath=false', 'diff', '4f1c2aa'])
    for (const flag of ['--relative', '--unified=0', '--no-color', '--no-ext-diff', '--no-textconv']) {
      expect(asked).toContain(flag)
    }
    expect(asked).toContain('--src-prefix=a/')
    expect(asked).toContain('--dst-prefix=b/')
  })

  test('neither the diff nor the untracked listing is asked for what /ripple web writes', () => {
    const paths = ['--', '.', ':(exclude).ripple']
    expect(diffCommand('HEAD').slice(-3)).toEqual(paths)
    expect(UNTRACKED_COMMAND.slice(-3)).toEqual(paths)
  })

  test('untracked files are hashed by name, each after the end of the options, and none means no command', () => {
    expect(hashCommand('')).toBeUndefined()
    expect(hashCommand('\n')).toBeUndefined()
    expect(hashCommand('src/fresh.ts\n-rf\n"src/we ird.ts"\n')).toEqual([
      'git',
      'hash-object',
      '--',
      'src/fresh.ts',
      '-rf',
      'src/we ird.ts',
    ])
  })

  test('past two hundred untracked files the rest go unhashed', () => {
    const many = Array.from({ length: 205 }, (_, index) => `f${index}.ts`).join('\n')
    const asked = hashCommand(many) ?? []
    expect(asked).toHaveLength(3 + 200)
    expect(asked.at(-1)).toBe('f199.ts')
  })
})

describe('the print of a reading', () => {
  test('the same diff under another scope is another print', () => {
    const uncommitted = readChanges('uncommitted', HEAD, DIFF, '')
    const branch = readChanges('branch', MAIN, DIFF, '')
    expect(uncommitted.print).not.toBe(branch.print)
    expect(readChanges('uncommitted', HEAD, DIFF, '').print).toBe(uncommitted.print)
  })

  test('one changed character changes the print, though the length stays', () => {
    const edited = DIFF.replace('TAX = 0.25', 'TAX = 0.35')
    expect(edited.length).toBe(DIFF.length)
    expect(printOf(edited)).not.toBe(printOf(DIFF))
  })

  test('a new untracked file changes the print, and so does an edit to one', () => {
    const before = readChanges('uncommitted', HEAD, DIFF, '')
    const added = readChanges('uncommitted', HEAD, DIFF, 'notes.md\n', '3e757656\n')
    expect(added.print).not.toBe(before.print)
    expect(readChanges('uncommitted', HEAD, DIFF, 'notes.md\n', 'be761e03\n').print).not.toBe(added.print)
  })
})

describe('what /ripple was asked', () => {
  test('nothing after the command maps the uncommitted changes', () => {
    expect(readRequest('')).toEqual({ verb: 'map', scope: 'uncommitted', focus: '' })
    expect(readRequest('   ')).toEqual({ verb: 'map', scope: 'uncommitted', focus: '' })
  })

  test('branch picks the scope and the rest is the focus', () => {
    expect(readRequest('branch')).toEqual({ verb: 'map', scope: 'branch', focus: '' })
    expect(readRequest(' Branch  could this  leak the token? ')).toEqual({
      verb: 'map',
      scope: 'branch',
      focus: 'could this leak the token?',
    })
  })

  test('any other words are a focus on the uncommitted changes', () => {
    expect(readRequest('formatPrice')).toEqual({ verb: 'map', scope: 'uncommitted', focus: 'formatPrice' })
  })

  test('web and reset are verbs only when they stand alone', () => {
    expect(readRequest(' WEB ')).toEqual({ verb: 'web' })
    expect(readRequest('reset')).toEqual({ verb: 'reset' })
    expect(readRequest('reset password flow')).toEqual({
      verb: 'map',
      scope: 'uncommitted',
      focus: 'reset password flow',
    })
  })
})

describe('describing the changes', () => {
  test('a scope reads the way the person would say it', () => {
    expect(describeChanges(readChanges('uncommitted', HEAD, DIFF, UNTRACKED))).toBe('8 uncommitted files')
    expect(describeChanges(readChanges('branch', MAIN, DIFF, ''))).toBe(
      '6 files changed on this branch since main',
    )
    const one = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n'
    expect(describeChanges(readChanges('uncommitted', HEAD, one, ''))).toBe('1 uncommitted file')
  })
})
