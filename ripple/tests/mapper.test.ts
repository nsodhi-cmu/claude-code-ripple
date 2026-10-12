import { describe, expect, test } from 'claude-code/testing'

import type { RippleMap } from '../types'
import { SHOP_MAP } from './fixture'
import type { ChangedFile, Changes } from '../hooks/changes'
import { HEAD } from '../hooks/changes'
import { askPrompt, languageNotes, reportReply, taskPrompt } from '../hooks/mapper'

const file = (path: string, rest: Partial<ChangedFile> = {}): ChangedFile => ({
  file: path,
  status: 'modified',
  hunks: 1,
  ...rest,
})

const changes = (files: ChangedFile[], rest: Partial<Changes> = {}): Changes => ({
  scope: 'uncommitted',
  base: HEAD,
  files,
  print: '1:a',
  ...rest,
})

const node = (map: RippleMap, name: string) => {
  const found = map.nodes.find(one => one.name === name)
  if (found === undefined) throw new Error(`no node ${name}`)
  return found
}

describe('the task a mapper is given', () => {
  test('it names the scope, the exact command to read it with, and how each file changed', () => {
    const task = taskPrompt(
      changes([
        file('src/price.ts', { hunks: 2 }),
        file('src/renamed.ts', { status: 'renamed', hunks: 0, from: 'src/moved.ts' }),
        file('src/gone.ts', { status: 'deleted' }),
        file('src/staged.ts', { status: 'added', hunks: 1 }),
        file('src/fresh.ts', { status: 'added', hunks: 0 }),
      ]),
      '',
    )
    expect(task.split('\n').slice(0, 9)).toEqual([
      'Map the uncommitted changes in this repository.',
      'Read them with `git diff HEAD`.',
      '',
      'Changed files:',
      '- src/price.ts (2 hunks)',
      '- src/renamed.ts (renamed from src/moved.ts)',
      '- src/gone.ts (deleted)',
      '- src/staged.ts (new)',
      '- src/fresh.ts (new, not in the diff: read the file)',
    ])
  })

  test('a branch is read against the commit it left the default branch at, named as the person names it', () => {
    const task = taskPrompt(
      changes([file('src/price.ts')], { scope: 'branch', base: { ref: '4f1c2aa', name: 'main' } }),
      '',
    )
    expect(task).toStartWith(
      'Map what this branch changed since it left main, uncommitted changes included.\nRead them with `git diff 4f1c2aa`.',
    )
  })

  test('a focus is passed on word for word, and without one nothing speaks of focus', () => {
    const focus = 'could this leak the session token?'
    expect(taskPrompt(changes([file('a.md')]), focus)).toContain(`\n\nFocus: ${focus}\nMap only what bears on this focus`)
    expect(taskPrompt(changes([file('a.md')]), '')).not.toContain('ocus')
  })

  test('past sixty files the rest are counted, not listed', () => {
    const many = Array.from({ length: 63 }, (_, index) => file(`src/f${index}.md`))
    const lines = taskPrompt(changes(many), '').split('\n')
    expect(lines.filter(line => line.startsWith('- src/'))).toHaveLength(60)
    expect(lines.at(-1)).toBe('- and 3 more files')
  })
})

describe('language notes', () => {
  const languages = (...paths: string[]): string[] =>
    languageNotes(paths.map(path => file(path))).map(note => note.slice(0, note.indexOf(':')))

  test('only the languages in the change are spoken of, each once', () => {
    expect(languages('src/a.ts', 'src/b.tsx', 'lib.rs', 'README.md')).toEqual(['TypeScript and JavaScript', 'Rust'])
    expect(languages('cmd/main.go', 'tools/gen.py', 'stubs/gen.pyi')).toEqual(['Python', 'Go'])
  })

  test('a language Ripple has no notes for adds nothing, and neither does a file with no extension', () => {
    expect(languages('Main.java', 'Makefile', 'docs/py')).toEqual([])
  })

  test('an extension is read whatever its case, and only from the end of the name', () => {
    expect(languages('LEGACY.PY')).toEqual(['Python'])
    expect(languages('go.mod', 'notes.rs.txt')).toEqual([])
  })

  test('the notes reach the task under their own heading', () => {
    const task = taskPrompt(changes([file('src/lib.rs')]), '')
    expect(task).toContain('\n\nNotes for the languages in this change:\n- Rust: A changed trait breaks every `impl` of it')
    expect(taskPrompt(changes([file('notes.txt')]), '')).not.toContain('Notes for the languages')
  })
})

describe('the answer to a report', () => {
  test('it counts what was drawn and lists what Ripple had to repair', () => {
    expect(reportReply(SHOP_MAP, [])).toBe(
      'Ripple drew the map: 1 changed, 6 dependents, 2 breaking, 1 to review. Reply with one short sentence and stop.',
    )
    expect(reportReply(SHOP_MAP, ['dropped 1 edge that named no node', 'kept 60 of 71 nodes'])).toContain(
      'to review. Ripple adjusted it: dropped 1 edge that named no node; kept 60 of 71 nodes. Reply',
    )
  })

  test('an empty report is answered as one', () => {
    expect(reportReply({ method: 'grep', nodes: [], edges: [] }, [])).toStartWith(
      'Ripple told the person the changes touch no symbol other code uses.',
    )
  })
})

describe('asking Claude about a node', () => {
  test('a flagged dependent comes with the change, the verdict, and the reason, and asks for no edits', () => {
    expect(askPrompt(node(SHOP_MAP, 'renderCart'), SHOP_MAP).split('\n')).toEqual([
      'Ripple mapped my uncommitted changes. Look at renderCart at src/cart.ts:14 (function).',
      'The changed symbols are formatPrice at src/price.ts:1.',
      "Ripple's mapper judged that the change breaks it: passes 1 argument; formatPrice now takes 2.",
      'Check whether the change really affects it, and say what you find and what the fix would be.',
      'Do not edit any files.',
    ])
    expect(askPrompt(node(SHOP_MAP, 'emailReceipt'), SHOP_MAP)).toContain('judged that it may now behave differently: passes')
  })

  test('a dependent that was not flagged carries no verdict', () => {
    expect(askPrompt(node(SHOP_MAP, 'priceLabel'), SHOP_MAP)).not.toContain('judged')
  })

  test('a changed symbol is asked about through what uses it, on the branch it was mapped on', () => {
    const branch: RippleMap = { ...SHOP_MAP, scope: 'branch', base: 'main' }
    expect(askPrompt(node(branch, 'formatPrice'), branch).split('\n')).toEqual([
      "Ripple mapped this branch's changes since main. Look at formatPrice at src/price.ts:1 (function).",
      'It changed: gained a required currency parameter.',
      'It is used by renderCart, renderInvoice, priceLabel, emailReceipt.',
      'Explain what the change does to the code that uses it.',
      'Do not edit any files.',
    ])
  })
})
