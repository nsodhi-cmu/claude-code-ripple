import { describe, expect, test } from 'claude-code/testing'

import type { RippleNode, RippleReport } from '../types'
import { SHOP_MAP } from './fixture'
import { fileOf, filesOf, symbolIn } from '../hooks/files'

const node = (name: string, file: string, rest: Partial<RippleNode> = {}): RippleNode => ({
  id: name,
  name,
  kind: 'function',
  file,
  line: 1,
  role: 'dependent',
  depth: 1,
  risk: 'ok',
  isTested: true,
  ...rest,
})

const report = (nodes: RippleNode[], edges: Array<[from: string, to: string]>): RippleReport => ({
  method: 'lsp',
  nodes,
  edges: edges.map(([from, to]) => ({ from, to })),
})

/** Each file in a line: what the views call it, its role, its depth, its risk, and its symbols in order. */
const brief = (map: RippleReport): string[] =>
  filesOf(map).files.map(
    file => `${file.name} · ${file.role} ${file.depth} · ${file.risk} · ${file.symbols.map(one => one.name).join(' ')}`,
  )

describe('the map by file', () => {
  test('each file holds the symbols the map has in it, by line, and stands where they do', () => {
    expect(brief(SHOP_MAP)).toEqual([
      'price.ts · changed 0 · ok · formatPrice',
      'cart.ts · dependent 1 · breaks · renderCart',
      'src/invoice.ts · dependent 1 · breaks · renderInvoice',
      'ui.ts · dependent 1 · ok · priceLabel',
      'email.ts · dependent 1 · review · emailReceipt',
      'checkout.ts · dependent 2 · ok · CheckoutPage',
      'pages/invoice.ts · dependent 2 · ok · InvoicePage',
      'money.ts · dependency 1 · ok · currencySymbol toFixed2',
    ])
  })

  test('two files are linked once however many of their symbols are, and never a file to itself', () => {
    const map = report(
      [
        node('core', 'src/core.ts', { role: 'changed', depth: 0 }),
        node('inside', 'src/core.ts'),
        node('a', 'src/user.ts'),
        node('b', 'src/user.ts'),
      ],
      [
        ['inside', 'core'],
        ['a', 'core'],
        ['b', 'core'],
        ['b', 'inside'],
      ],
    )
    expect(filesOf(map).links).toEqual([{ from: 'src/user.ts', to: 'src/core.ts' }])
  })

  test('a file is called by the end of its path, with the folders it takes to tell it from the others', () => {
    const paths = ['src/a/index.ts', 'src/b/index.ts', 'lib/b/index.ts', 'index.ts', 'src/util.ts']
    const map = report(
      paths.map((path, index) => node(`n${index}`, path)),
      [],
    )
    expect(filesOf(map).files.map(file => file.name)).toEqual([
      'a/index.ts',
      'src/b/index.ts',
      'lib/b/index.ts',
      'index.ts',
      'util.ts',
    ])
  })

  test('a file with a changed symbol in it is a changed file, and takes the worst risk of all it holds', () => {
    const map = report(
      [
        node('helper', 'src/core.ts', { role: 'dependency', line: 30 }),
        node('caller', 'src/core.ts', { risk: 'breaks', line: 20 }),
        node('core', 'src/core.ts', { role: 'changed', depth: 0, line: 10 }),
        node('watcher', 'src/watch.ts', { risk: 'review' }),
        node('fine', 'src/watch.ts'),
      ],
      [
        ['caller', 'core'],
        ['core', 'helper'],
        ['watcher', 'core'],
      ],
    )
    expect(brief(map)).toEqual([
      'core.ts · changed 0 · breaks · core caller helper',
      'watch.ts · dependent 1 · review · watcher fine',
    ])
  })

  test('a file stands as many files from the change as its links run, however deep its symbols are', () => {
    const map = report(
      [
        node('core', 'src/core.ts', { role: 'changed', depth: 0 }),
        node('wrapper', 'src/core.ts'),
        node('page', 'src/page.ts', { depth: 2 }),
        node('app', 'src/app.ts', { depth: 3 }),
        node('inner', 'src/inner.ts', { role: 'dependency' }),
        node('innermost', 'src/innermost.ts', { role: 'dependency', depth: 2 }),
      ],
      [
        ['wrapper', 'core'],
        ['page', 'wrapper'],
        ['app', 'page'],
        ['core', 'inner'],
        ['inner', 'innermost'],
      ],
    )
    expect(filesOf(map).files.map(file => [file.name, file.role, file.depth])).toEqual([
      ['core.ts', 'changed', 0],
      ['page.ts', 'dependent', 1],
      ['app.ts', 'dependent', 2],
      ['inner.ts', 'dependency', 1],
      ['innermost.ts', 'dependency', 2],
    ])
  })

  test('a file no link ties to the change stands where the nearest of its symbols does', () => {
    const map = report(
      [
        node('core', 'src/core.ts', { role: 'changed', depth: 0 }),
        node('far', 'src/adrift.ts', { depth: 3 }),
        node('nearer', 'src/adrift.ts', { depth: 2 }),
      ],
      [],
    )
    expect(filesOf(map).files.map(file => [file.name, file.depth])).toEqual([
      ['core.ts', 0],
      ['adrift.ts', 2],
    ])
  })
})

describe('the selected file', () => {
  const shop = filesOf(SHOP_MAP)

  test('it is the one that holds the selected symbol', () => {
    expect(fileOf(shop, 'src/money.ts:toFixed2')?.path).toBe('src/money.ts')
    expect(fileOf(shop, 'src/gone.ts:removed')).toBeUndefined()
    expect(fileOf(shop, null)).toBeUndefined()
  })

  test('selecting a file keeps the symbol already selected in it, and otherwise takes its first', () => {
    const money = fileOf(shop, 'src/money.ts:toFixed2')
    if (money === undefined) throw new Error('no money.ts')
    expect(symbolIn(money, 'src/money.ts:toFixed2')?.name).toBe('toFixed2')
    expect(symbolIn(money, 'src/cart.ts:renderCart')?.name).toBe('currencySymbol')
    expect(symbolIn(money, null)?.name).toBe('currencySymbol')
  })
})
