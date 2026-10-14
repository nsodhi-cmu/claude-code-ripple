import { expect, test } from 'claude-code/testing'

import type { RippleNode } from '../types'
import { SHOP_MAP } from './fixture'
import { filesOf } from '../hooks/files'
import { graphOf } from '../hooks/graph'

const SHOP = graphOf(filesOf(SHOP_MAP))

const node = (name: string, file: string, rest: Partial<RippleNode> = {}): RippleNode => ({
  id: `${file}:${name}`,
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

test('a file is a node under its path, saying its mark, its name, and how many symbols it holds when more than one', () => {
  expect(SHOP.nodes.find(one => one.id === 'src/money.ts')).toEqual({
    id: 'src/money.ts',
    label: 'money.ts',
    mark: '→',
    tone: 'dim',
    badge: '2',
    layer: 1,
  })
  expect(SHOP.nodes.find(one => one.id === 'src/cart.ts')).toEqual({
    id: 'src/cart.ts',
    label: 'cart.ts',
    mark: '●',
    tone: 'bad',
    layer: -1,
  })
})

test('the layers run from the farthest files that use the change, through the change, down to the files it uses', () => {
  const layers = new Map<number, string[]>()
  for (const one of SHOP.nodes) layers.set(one.layer ?? 0, [...(layers.get(one.layer ?? 0) ?? []), one.label])
  expect([...layers].sort(([a], [b]) => a - b)).toEqual([
    [-2, ['checkout.ts', 'pages/invoice.ts']],
    [-1, ['cart.ts', 'src/invoice.ts', 'ui.ts', 'email.ts']],
    [0, ['price.ts']],
    [1, ['money.ts']],
  ])
})

test('a link runs from the file that uses to the file that is used, once however many symbols use it', () => {
  expect(SHOP.links).toContainEqual({ from: 'src/cart.ts', to: 'src/price.ts' })
  expect(SHOP.links.filter(link => link.from === 'src/price.ts')).toEqual([{ from: 'src/price.ts', to: 'src/money.ts' }])
})

test('a changed file at risk keeps the mark of a change and takes the tone of its risk', () => {
  const graph = graphOf(
    filesOf({
      method: 'lsp',
      nodes: [
        node('a', 'a.ts', { role: 'changed', depth: 0, risk: 'review' }),
        node('b', 'b.ts', { role: 'changed', depth: 0 }),
        node('c', 'c.ts', { risk: 'ok' }),
      ],
      edges: [{ from: 'c.ts:c', to: 'a.ts:a' }],
    }),
  )
  expect(graph.nodes.map(one => [one.mark, one.tone])).toEqual([
    ['◆', 'warn'],
    ['◆', 'note'],
    ['○', 'plain'],
  ])
})
