import { describe, expect, test } from 'claude-code/testing'

import type { RippleNode, RippleReport } from '../types'
import { SHOP_MAP } from './fixture'
import { MAX_NODES } from '../hooks/map'
import { RING, SVG_LIMIT, ringLayout, ringSvg } from '../hooks/rings'

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

const spot = (map: RippleReport, name: string) => {
  const found = ringLayout(map).find(one => one.node.name === name)
  if (found === undefined) throw new Error(`${name} was not placed`)
  return found
}

const dependent = (name: string, depth: number, extra: Partial<RippleNode> = {}): RippleNode => ({
  id: name,
  name,
  kind: 'function',
  file: `src/${name}.ts`,
  line: 1,
  role: 'dependent',
  depth,
  risk: 'ok',
  isTested: true,
  ...extra,
})

const changed = (name: string): RippleNode => dependent(name, 0, { role: 'changed', change: 'behavior' })

/** One changed symbol with `near` direct dependents and `far` dependents of those. */
const crowd = (near: number, far: number): RippleReport => {
  const nodes: RippleNode[] = [changed('core')]
  const edges: RippleReport['edges'] = []
  for (let index = 0; index < near; index += 1) {
    nodes.push(dependent(`near${index}`, 1))
    edges.push({ from: `near${index}`, to: 'core' })
  }
  for (let index = 0; index < far; index += 1) {
    nodes.push(dependent(`far${index}`, 2))
    edges.push({ from: `far${index}`, to: `near${index % Math.max(near, 1)}` })
  }
  return { method: 'grep', nodes, edges }
}

describe('ring layout', () => {
  test('one changed symbol sits at the center', () => {
    const center = spot(SHOP_MAP, 'formatPrice')
    expect([center.ring, center.x, center.y]).toEqual(['center', RING.center, RING.center])
  })

  test('direct dependents are spread evenly around the near ring, from the top', () => {
    const at = (name: string) => [spot(SHOP_MAP, name).x, spot(SHOP_MAP, name).y]
    expect(at('renderCart')).toEqual([320, 180])
    expect(at('renderInvoice')).toEqual([460, 320])
    expect(at('priceLabel')).toEqual([320, 460])
    expect(at('emailReceipt')).toEqual([180, 320])
  })

  test('a dependent of a dependent sits straight out from the one it uses', () => {
    const checkout = spot(SHOP_MAP, 'CheckoutPage')
    const invoice = spot(SHOP_MAP, 'InvoicePage')
    expect([checkout.ring, checkout.x, checkout.y]).toEqual(['far', 320, 90])
    expect([invoice.x, invoice.y]).toEqual([550, 320])
    expect(checkout.angle).toBe(spot(SHOP_MAP, 'renderCart').angle)
  })

  test('dependencies sit on the inner ring, between the dependents', () => {
    const fixed = spot(SHOP_MAP, 'toFixed2')
    const symbol = spot(SHOP_MAP, 'currencySymbol')
    expect([fixed.ring, fixed.x, fixed.y]).toEqual(['dependencies', 369.5, 270.5])
    expect([symbol.x, symbol.y]).toEqual([270.5, 369.5])
  })

  test('several changed symbols share a small circle around the center', () => {
    const pair: RippleReport = { method: 'lsp', nodes: [changed('one'), changed('two')], edges: [] }
    expect([spot(pair, 'one').x, spot(pair, 'one').y]).toEqual([320, 320 - RING.changed])
    expect([spot(pair, 'two').x, spot(pair, 'two').y]).toEqual([320, 320 + RING.changed])
  })

  test('siblings fan around the dependent they use, and no two far nodes share a seat', () => {
    const fan = ringLayout(crowd(2, 6)).filter(one => one.ring === 'far')
    const angles = fan.map(one => one.angle).sort((a, b) => a - b)
    for (let index = 1; index < angles.length; index += 1) {
      expect((angles[index] ?? 0) - (angles[index - 1] ?? 0)).toBeGreaterThan(0.3)
    }
    const top = fan.filter(one => one.node.name === 'far0' || one.node.name === 'far2' || one.node.name === 'far4')
    const mean = top.reduce((sum, one) => sum + one.angle, 0) / top.length
    expect(Math.abs(mean - -Math.PI / 2)).toBeLessThan(1e-9)
  })

  test('a full far ring keeps every node by the dependent it uses, inside one turn', () => {
    const full = ringLayout(crowd(3, 30)).filter(one => one.ring === 'far')
    const angles = full.map(one => one.angle).sort((a, b) => a - b)
    expect(angles).toHaveLength(30)
    expect((angles[29] ?? 0) - (angles[0] ?? 0)).toBeLessThan(Math.PI * 2 - 0.15)
    for (let index = 1; index < angles.length; index += 1) {
      expect((angles[index] ?? 0) - (angles[index - 1] ?? 0)).toBeGreaterThan(0.15)
    }
  })

  test('a fan that would wrap onto the first node is spread evenly instead', () => {
    const lopsided = crowd(3, 0)
    const far = ['x0', 'x1', ...Array.from({ length: 10 }, (_, index) => `y${index}`)]
    far.forEach((name, index) => {
      lopsided.nodes.push(dependent(name, 2))
      lopsided.edges.push({ from: name, to: `near${Math.min(index, 2)}` })
    })
    const angles = ringLayout(lopsided)
      .filter(one => one.ring === 'far')
      .map(one => one.angle)
      .sort((a, b) => a - b)
    expect(angles).toHaveLength(12)
    const step = (Math.PI * 2) / 12
    for (let index = 1; index < angles.length; index += 1) {
      expect(Math.abs((angles[index] ?? 0) - (angles[index - 1] ?? 0) - step)).toBeLessThan(1e-9)
    }
  })
})

describe('ring svg', () => {
  const svg = ringSvg(SHOP_MAP)

  test('is one svg document, far under the Svg element limit', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg.length).toBeLessThan(SVG_LIMIT / 8)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('undefined')
    expect(svg).not.toContain('NaN')
  })

  test('draws a dot and a tooltip for every node, an edge for every use', () => {
    expect(count(svg, '<g class="n">')).toBe(SHOP_MAP.nodes.length)
    expect(count(svg, '<line ')).toBe(SHOP_MAP.edges.length)
    expect(svg).toContain('<title>renderCart · src/cart.ts:14\nbreaks · untested\npasses 1 argument; formatPrice now takes 2</title>')
    expect(svg).toContain('>src/pages/checkout.ts:5</text>')
  })

  test('an edge takes the color of the flagged dependent it leads out to, and untested nodes are dashed', () => {
    expect(count(svg, 'stroke="#ef4444" stroke-width="1.6"')).toBe(2)
    expect(count(svg, 'stroke="#f59e0b" stroke-width="1.6"')).toBe(1)
    expect(count(svg, 'stroke-dasharray="3 2.4"')).toBe(1)
    const calmer = ringSvg({
      ...SHOP_MAP,
      nodes: SHOP_MAP.nodes.map(node => (node.name === 'renderCart' ? { ...node, risk: 'ok' as const } : node)),
    })
    expect(count(calmer, 'stroke="#ef4444" stroke-width="1.6"')).toBe(1)
    expect(count(calmer, 'fill="#ef4444"')).toBe(1)
  })

  test('a dependent and the dependent of it never share a label row', () => {
    const rows = (name: string) =>
      [...svg.matchAll(new RegExp(`y="([\\d.]+)"[^>]*>${name}</text>`, 'g'))].map(match => Number(match[1]))
    const [near] = rows('renderInvoice')
    const [far] = rows('InvoicePage')
    expect(near).toBeLessThan(320)
    expect(far).toBeGreaterThan(320)
  })

  test('names are cut to 18 characters and escaped', () => {
    const odd = ringSvg({
      method: 'grep',
      nodes: [
        changed('core'),
        dependent('aVeryLongFunctionNameIndeed', 1),
        dependent('a<b>&"c"', 1, { reason: "it's <odd>" }),
      ],
      edges: [],
    })
    expect(odd).toContain('>aVeryLongFunction…</text>')
    expect(odd).toContain('>a&lt;b&gt;&amp;&quot;c&quot;</text>')
    expect(odd).toContain('it&#39;s &lt;odd&gt;')
    expect(odd).not.toContain('<b>')
  })

  test('a map at the node cap stays well under the limit', () => {
    const big = ringSvg(crowd(30, MAX_NODES - 31))
    expect(count(big, '<g class="n">')).toBe(MAX_NODES)
    expect(big.length).toBeLessThan(SVG_LIMIT / 3)
  })

  test('an empty map is still a picture', () => {
    const empty = ringSvg({ method: 'grep', nodes: [], edges: [] })
    expect(empty.endsWith('</svg>')).toBe(true)
    expect(count(empty, '<g class="n">')).toBe(0)
  })
})
