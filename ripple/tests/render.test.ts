import { describe, expect, test } from 'claude-code/testing'

import type { RippleMap, RippleNode } from '../types'
import { SHOP_MAP } from './fixture'
import {
  KEY,
  RING,
  SVG_LIMIT,
  WIDE_COLUMNS,
  graphHtml,
  layoutTree,
  lineText,
  ringLayout,
  ringSvg,
  treeRows,
} from '../hooks/render'

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

const spot = (map: RippleMap, name: string) => {
  const found = ringLayout(map).find(one => one.node.name === name)
  if (found === undefined) throw new Error(`${name} was not placed`)
  return found
}

const caller = (name: string, depth: number, extra: Partial<RippleNode> = {}): RippleNode => ({
  id: name,
  name,
  file: `src/${name}.ts`,
  line: 1,
  kind: 'caller',
  depth,
  status: 'ok',
  tested: true,
  ...extra,
})

/** One changed function with `near` direct callers and `far` callers of those. */
const crowd = (near: number, far: number): RippleMap => {
  const nodes: RippleNode[] = [{ ...caller('core', 0), kind: 'changed', change: 'behavior' }]
  const edges: RippleMap['edges'] = []
  for (let index = 0; index < near; index += 1) {
    nodes.push(caller(`near${index}`, 1))
    edges.push({ from: `near${index}`, to: 'core' })
  }
  for (let index = 0; index < far; index += 1) {
    nodes.push(caller(`far${index}`, 2))
    edges.push({ from: `far${index}`, to: `near${index % Math.max(near, 1)}` })
  }
  return { method: 'grep', nodes, edges }
}

describe('tree view', () => {
  test('callers hang under what they call, callees on a last line', () => {
    const rows = treeRows(SHOP_MAP)
    expect(rows.map(row => `${row.lead}${row.glyph} ${row.name}`.trimEnd())).toEqual([
      '◉ formatPrice',
      '├─ ● renderCart',
      '│  └─ ○ CheckoutPage',
      '├─ ● renderInvoice',
      '│  └─ ○ InvoicePage',
      '├─ ○ priceLabel',
      '└─ ● emailReceipt',
      '    calls → toFixed2, currencySymbol',
    ])
    expect(rows[0]?.note).toBe('signature changed')
    expect(rows[1]?.note).toBe('NEEDS REVIEW · untested')
    expect(rows[5]?.note).toBe('')
  })

  test('wide: one line a node, in three aligned columns', () => {
    const lines = layoutTree(treeRows(SHOP_MAP), 140).map(lineText)
    expect(lines).toHaveLength(8)
    expect(lines[0]).toMatch(/^◉ formatPrice\s+src\/price\.ts:1\s+signature changed$/)
    expect(lines[1]).toMatch(
      /^├─ ● renderCart\s+src\/cart\.ts:14\s+NEEDS REVIEW · untested · passes 1 argument; formatPrice now takes 2$/,
    )
    expect(lines[2]).toBe('│  └─ ○ CheckoutPage  src/pages/checkout.ts:5')
    expect(lines[7]).toBe('   calls → toFixed2, currencySymbol')
    const column = lines.slice(0, 7).map(line => line.indexOf('src/'))
    expect(new Set(column).size).toBe(1)
    const notes = [lines[0]?.indexOf('signature'), lines[1]?.indexOf('NEEDS'), lines[3]?.indexOf('NEEDS')]
    expect(new Set(notes).size).toBe(1)
  })

  test('wide: a reason too long for its column wraps under itself', () => {
    const lines = layoutTree(treeRows(SHOP_MAP), WIDE_COLUMNS).map(lineText)
    expect(lines).toHaveLength(11)
    expect(lines[1]).toMatch(/^├─ ● renderCart\s+src\/cart\.ts:14\s+NEEDS REVIEW · untested · passes 1$/)
    expect(lines[2]).toMatch(/^│  │\s+argument; formatPrice now takes 2$/)
    expect(lines[2]?.indexOf('argument')).toBe(lines[1]?.indexOf('NEEDS'))
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(WIDE_COLUMNS)
  })

  test('narrow: the note sits by the name, the location and reason under it', () => {
    const lines = layoutTree(treeRows(SHOP_MAP), 48).map(lineText)
    expect(lines).toEqual([
      '◉ formatPrice  signature changed',
      '│ src/price.ts:1',
      '├─ ● renderCart  NEEDS REVIEW · untested',
      '│  │ src/cart.ts:14 · passes 1 argument;',
      '│  │ formatPrice now takes 2',
      '│  └─ ○ CheckoutPage  src/pages/checkout.ts:5',
      '├─ ● renderInvoice  NEEDS REVIEW',
      '│  │ src/invoice.ts:11 · passes 1 argument;',
      '│  │ invoice.currency is not passed',
      '│  └─ ○ InvoicePage  src/pages/invoice.ts:5',
      '├─ ○ priceLabel  src/ui.ts:4',
      '└─ ● emailReceipt  NEEDS REVIEW',
      '     src/email.ts:6 · passes 1 argument;',
      '     receipt.currency is not passed',
      '   calls → toFixed2, currencySymbol',
    ])
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(48)
  })

  test('narrower still: a location with no room beside the name goes under it', () => {
    const lines = layoutTree(treeRows(SHOP_MAP), 30).map(lineText)
    expect(lines.slice(5, 8)).toEqual([
      '│  │ takes 2',
      '│  └─ ○ CheckoutPage',
      '│       src/pages/checkout.ts:5',
    ])
  })

  test('an updated caller reads as updated and loses its emphasis', () => {
    const fixed: RippleMap = {
      ...SHOP_MAP,
      nodes: SHOP_MAP.nodes.map(node =>
        node.name === 'renderCart' ? { ...node, status: 'updated' as const } : node,
      ),
    }
    const line = layoutTree(treeRows(fixed), 48).find(one => one.id === 'src/cart.ts:renderCart')
    expect(line === undefined ? '' : lineText(line)).toBe('├─ ✓ renderCart  updated · untested')
    expect(line?.segments[1]).toEqual({ text: '✓ renderCart', tone: 'updated' })
  })

  test('a map with no changed node still lists its callers', () => {
    const rows = treeRows({ method: 'grep', nodes: [caller('a', 1), caller('b', 2)], edges: [{ from: 'b', to: 'a' }] })
    expect(rows.map(row => `${row.lead}${row.name}`)).toEqual(['a', '└─ b'])
    expect(treeRows({ method: 'grep', nodes: [], edges: [] })).toEqual([])
  })
})

describe('ring layout', () => {
  test('one changed function sits at the center', () => {
    const center = spot(SHOP_MAP, 'formatPrice')
    expect([center.ring, center.x, center.y]).toEqual(['center', RING.center, RING.center])
  })

  test('direct callers are spread evenly round the near ring, from the top', () => {
    const at = (name: string) => [spot(SHOP_MAP, name).x, spot(SHOP_MAP, name).y]
    expect(at('renderCart')).toEqual([320, 180])
    expect(at('renderInvoice')).toEqual([460, 320])
    expect(at('priceLabel')).toEqual([320, 460])
    expect(at('emailReceipt')).toEqual([180, 320])
  })

  test('a caller of a caller sits straight out from the caller it calls', () => {
    const checkout = spot(SHOP_MAP, 'CheckoutPage')
    const invoice = spot(SHOP_MAP, 'InvoicePage')
    expect([checkout.ring, checkout.x, checkout.y]).toEqual(['far', 320, 90])
    expect([invoice.x, invoice.y]).toEqual([550, 320])
    expect(checkout.angle).toBe(spot(SHOP_MAP, 'renderCart').angle)
  })

  test('callees sit on the inner ring, between the callers', () => {
    const fixed = spot(SHOP_MAP, 'toFixed2')
    const symbol = spot(SHOP_MAP, 'currencySymbol')
    expect([fixed.ring, fixed.x, fixed.y]).toEqual(['callees', 369.5, 270.5])
    expect([symbol.x, symbol.y]).toEqual([270.5, 369.5])
  })

  test('several changed functions share a small circle round the center', () => {
    const pair: RippleMap = {
      method: 'lsp',
      nodes: [
        { ...caller('one', 0), kind: 'changed' },
        { ...caller('two', 0), kind: 'changed' },
      ],
      edges: [],
    }
    expect([spot(pair, 'one').x, spot(pair, 'one').y]).toEqual([320, 320 - RING.changed])
    expect([spot(pair, 'two').x, spot(pair, 'two').y]).toEqual([320, 320 + RING.changed])
  })

  test('siblings fan round their caller, and no two far nodes share a seat', () => {
    const fan = ringLayout(crowd(2, 6)).filter(one => one.ring === 'far')
    const angles = fan.map(one => one.angle).sort((a, b) => a - b)
    for (let index = 1; index < angles.length; index += 1) {
      expect((angles[index] ?? 0) - (angles[index - 1] ?? 0)).toBeGreaterThan(0.3)
    }
    const top = fan.filter(one => one.node.name === 'far0' || one.node.name === 'far2' || one.node.name === 'far4')
    const mean = top.reduce((sum, one) => sum + one.angle, 0) / top.length
    expect(Math.abs(mean - -Math.PI / 2)).toBeLessThan(1e-9)
  })

  test('a full far ring keeps every node by its caller, inside one turn', () => {
    const full = ringLayout(crowd(3, 30)).filter(one => one.ring === 'far')
    const angles = full.map(one => one.angle).sort((a, b) => a - b)
    expect(angles).toHaveLength(30)
    expect((angles[29] ?? 0) - (angles[0] ?? 0)).toBeLessThan(Math.PI * 2 - 0.15)
    for (let index = 1; index < angles.length; index += 1) {
      expect((angles[index] ?? 0) - (angles[index - 1] ?? 0)).toBeGreaterThan(0.15)
    }
  })

  test('a fan that would wrap onto the first node is spread evenly instead', () => {
    // Three callers a third of a turn apart; the last one has ten callers of its own.
    const lopsided = crowd(3, 0)
    const far = ['x0', 'x1', ...Array.from({ length: 10 }, (_, index) => `y${index}`)]
    far.forEach((name, index) => {
      lopsided.nodes.push(caller(name, 2))
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

  test('draws a dot and a tooltip for every node, an edge for every call', () => {
    expect(count(svg, '<g class="n">')).toBe(SHOP_MAP.nodes.length)
    expect(count(svg, '<line ')).toBe(SHOP_MAP.edges.length)
    expect(svg).toContain('<title>renderCart · src/cart.ts:14\nneeds review · untested\npasses 1 argument; formatPrice now takes 2</title>')
    expect(svg).toContain('>src/pages/checkout.ts:5</text>')
  })

  test('edges into a needs-review caller are red, untested nodes dashed', () => {
    expect(count(svg, 'stroke="#ef4444" stroke-width="1.6"')).toBe(3)
    expect(count(svg, 'stroke-dasharray="3 2.4"')).toBe(1)
    expect(count(svg, 'fill="#22c55e"')).toBe(0)
    const fixed = ringSvg({
      ...SHOP_MAP,
      nodes: SHOP_MAP.nodes.map(node =>
        node.name === 'renderCart' ? { ...node, status: 'updated' as const } : node,
      ),
    })
    expect(count(fixed, 'stroke="#ef4444" stroke-width="1.6"')).toBe(2)
    expect(count(fixed, 'stroke="#22c55e" stroke-width="1.6"')).toBe(1)
    expect(count(fixed, 'fill="#22c55e"')).toBe(1)
  })

  test('a caller and the caller of it never share a label row', () => {
    // renderInvoice and InvoicePage sit on one sideways spoke: one over, one under.
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
        { ...caller('core', 0), kind: 'changed' },
        caller('aVeryLongFunctionNameIndeed', 1),
        caller('a<b>&"c"', 1, { reason: "it's <odd>" }),
      ],
      edges: [],
    })
    expect(odd).toContain('>aVeryLongFunction…</text>')
    expect(odd).toContain('>a&lt;b&gt;&amp;&quot;c&quot;</text>')
    expect(odd).toContain('it&#39;s &lt;odd&gt;')
    expect(odd).not.toContain('<b>')
  })

  test('a full map of 40 nodes stays small', () => {
    const big = ringSvg(crowd(20, 19))
    expect(count(big, '<g class="n">')).toBe(40)
    expect(big.length).toBeLessThan(SVG_LIMIT / 3)
  })

  test('an empty map is still a picture', () => {
    const empty = ringSvg({ method: 'grep', nodes: [], edges: [] })
    expect(empty.endsWith('</svg>')).toBe(true)
    expect(count(empty, '<g class="n">')).toBe(0)
  })
})

describe('web page', () => {
  const html = graphHtml(SHOP_MAP)

  test('holds the ring view and what the hover script reads', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<h1>Ripple · 1 change → 6 callers · 3 need review · via LSP</h1>')
    expect(html).toContain('data-name="renderCart" data-loc="src/cart.ts:14" data-status="needs review · untested"')
    expect(count(html, '<script>')).toBe(1)
    expect(html).toContain("node.addEventListener('mousemove'")
  })

  test('says under the picture what every mark means and where it comes from', () => {
    expect(KEY.map(entry => entry.label)).toEqual(['changed', 'needs review', 'updated', 'ok', 'callee', 'untested'])
    for (const entry of KEY) {
      expect(html).toContain(`<b>${entry.label}</b>`)
      expect(entry.means.length).toBeGreaterThan(30)
    }
    expect(html).toContain('Claude found no test file that mentions this function by name. Nothing is run')
    expect(html).toContain('Ripple sets this from the diff; it does not prove the fix is right.')
    expect(html).toContain('Ripple runs no tests and no analysis of its own.')
  })

  test('is a still page: nothing pulses or moves', () => {
    for (const text of [html, ringSvg(SHOP_MAP)]) {
      expect(text).not.toContain('<animate')
      expect(text).not.toContain('animation')
      expect(text).not.toContain('@keyframes')
      expect(text).not.toContain('transition')
    }
  })
})
