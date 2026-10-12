import { describe, expect, test } from 'claude-code/testing'

import type { RippleNode, RippleReport } from '../types'
import { SHOP_MAP } from './fixture'
import { rowText } from '../hooks/draw'
import type { Drawing, Span } from '../hooks/draw'
import { GRAPH_COLUMNS, drawGraph, layersOf, stepInGraph } from '../hooks/graph'

const id = (name: string): string => {
  const found = SHOP_MAP.nodes.find(node => node.name === name)
  if (found === undefined) throw new Error(`no node ${name}`)
  return found.id
}

const picture = (drawing: Drawing): string[] => drawing.rows.map(rowText)

/** Every span of the drawing whose text holds `text`. */
const spansWith = (drawing: Drawing, text: string): Span[] =>
  drawing.rows.flatMap(row => row.filter(span => span.text.includes(text)))

const names = (layers: RippleNode[][]): string[][] => layers.map(layer => layer.map(node => node.name))

const node = (name: string, rest: Partial<RippleNode> = {}): RippleNode => ({
  id: name,
  name,
  kind: 'function',
  file: `src/${name}.ts`,
  line: 1,
  role: 'dependent',
  depth: 1,
  risk: 'ok',
  isTested: true,
  ...rest,
})

const CORE = node('core', { role: 'changed', depth: 0, change: 'behavior' })

/** One changed symbol and `count` dependents of it, the last `breaking` of them breaking. */
const wide = (count: number, breaking = 1): RippleReport => {
  const dependents = Array.from({ length: count }, (_, index) =>
    node(`dependent${index}`, index >= count - breaking ? { risk: 'breaks', reason: 'gone' } : {}),
  )
  return {
    method: 'grep',
    nodes: [CORE, ...dependents],
    edges: dependents.map(dependent => ({ from: dependent.id, to: 'core' })),
  }
}

describe('layers', () => {
  test('they run from the farthest dependents down to the dependencies', () => {
    expect(names(layersOf(SHOP_MAP))).toEqual([
      ['CheckoutPage', 'InvoicePage'],
      ['renderCart', 'renderInvoice', 'priceLabel', 'emailReceipt'],
      ['formatPrice'],
      ['toFixed2', 'currencySymbol'],
    ])
  })

  test('a layer is ordered by what it is linked to in the layer nearer the change, so edges do not cross', () => {
    const crossed: RippleReport = {
      method: 'lsp',
      nodes: [
        CORE,
        node('left'),
        node('right'),
        node('usesRight', { depth: 2 }),
        node('usesLeft', { depth: 2 }),
        node('usesNothing', { depth: 2 }),
        node('usedSecond', { role: 'dependency' }),
        node('usedFirst', { role: 'dependency' }),
        node('deeper', { role: 'dependency', depth: 2 }),
      ],
      edges: [
        { from: 'left', to: 'core' },
        { from: 'right', to: 'core' },
        { from: 'usesRight', to: 'right' },
        { from: 'usesLeft', to: 'left' },
        { from: 'core', to: 'usedSecond' },
        { from: 'core', to: 'usedFirst' },
        { from: 'usedFirst', to: 'deeper' },
      ],
    }
    expect(names(layersOf(crossed))).toEqual([
      ['usesLeft', 'usesRight', 'usesNothing'],
      ['left', 'right'],
      ['core'],
      ['usedSecond', 'usedFirst'],
      ['deeper'],
    ])
  })
})

describe('the drawing', () => {
  test('boxes sit in layers, each over what it uses, with the edges between them', () => {
    expect(picture(drawGraph(SHOP_MAP, id('renderInvoice'), { columns: 90, rows: 40 }))).toEqual([
      '      ┌────────────────┐  ┌───────────────┐',
      '      │ ○ CheckoutPage │  │ ○ InvoicePage │',
      '      └────────┬───────┘  └───────┬───────┘',
      '               │                  │',
      '               ▼                  ▼',
      '       ┌──────────────┐  ╔═════════════════╗  ┌──────────────┐  ┌────────────────┐',
      '       │ ● renderCart │  ║ ● renderInvoice ║  │ ○ priceLabel │  │ ▲ emailReceipt │',
      '       └───────┬──────┘  ╚════════╤════════╝  └───────┬──────┘  └────────┬───────┘',
      '               └──────────────────┴─────────┬─────────┴──────────────────┘',
      '                                            ▼',
      '                                    ┌───────────────┐',
      '                                    │ ◆ formatPrice │',
      '                                    └───────┬───────┘',
      '                                   ┌────────┴─────────┐',
      '                                   ▼                  ▼',
      '                            ┌────────────┐  ┌──────────────────┐',
      '                            │ → toFixed2 │  │ → currencySymbol │',
      '                            └────────────┘  └──────────────────┘',
    ])
  })

  test('the selected box and the edges that touch it are painted apart from the rest', () => {
    const drawing = drawGraph(SHOP_MAP, id('renderInvoice'), { columns: 90, rows: 40 })
    expect(spansWith(drawing, '● renderInvoice')).toEqual([
      { text: '● renderInvoice', paint: 'breaks', isBold: true, isInverse: true },
    ])
    expect(spansWith(drawing, '╔').every(span => span.paint === 'accent')).toBe(true)
    // Its edge down to formatPrice and the one in from InvoicePage are lit; CheckoutPage's is not.
    const [checkout, invoice] = (drawing.rows[4] ?? []).filter(span => span.text === '▼')
    expect([checkout?.paint, invoice?.paint]).toEqual(['dim', 'accent'])
    expect(spansWith(drawing, '● renderCart')).toEqual([{ text: '● renderCart', paint: 'breaks' }])
    expect(spansWith(drawing, '○ priceLabel').map(span => span.paint)).toEqual(['plain'])
  })

  test('every box is a hit over exactly its own cells, and no two hits overlap', () => {
    const drawing = drawGraph(SHOP_MAP, id('renderCart'), { columns: 90, rows: 40 })
    const rows = picture(drawing)
    expect(drawing.hits).toHaveLength(SHOP_MAP.nodes.length)
    for (const hit of drawing.hits) {
      const name = SHOP_MAP.nodes.find(one => one.id === hit.id)?.name ?? 'missing'
      expect('┌╔').toContain(rows[hit.y]?.[hit.x] ?? ' ')
      expect('┘╝').toContain(rows[hit.y + hit.height - 1]?.[hit.x + hit.width - 1] ?? ' ')
      expect(rows[hit.y + 1]?.slice(hit.x, hit.x + hit.width)).toContain(name)
    }
    const cells = drawing.hits.flatMap(hit =>
      Array.from({ length: hit.width * hit.height }, (_, index) => `${hit.x + (index % hit.width)},${hit.y + Math.floor(index / hit.width)}`),
    )
    expect(new Set(cells).size).toBe(cells.length)
  })

  test('an empty map draws nothing', () => {
    expect(drawGraph({ method: 'grep', nodes: [], edges: [] }, null, { columns: 80, rows: 40 })).toEqual({
      rows: [],
      hits: [],
    })
  })
})

describe('a layer too wide for the room', () => {
  test('folds what matters least into a box that counts it, and draws the edges of what it holds to the box', () => {
    expect(picture(drawGraph(SHOP_MAP, id('priceLabel'), { columns: 44, rows: 40 })).slice(0, 10)).toEqual([
      '       ┌────────────────┐  ┌───────────────┐',
      '       │ ○ CheckoutPage │  │ ○ InvoicePage │',
      '       └────────┬───────┘  └─┬─────────────┘',
      '                └────────────┤',
      '                             ▼',
      '      ╔══════════════╗  ┌╌╌╌╌╌╌╌╌╌┐',
      '      ║ ○ priceLabel ║  ╎ +3 more ╎',
      '      ╚═══════╤══════╝  └╌╌╌╌╌╌╌╌╌┘',
      '              └──────┬───────┘',
      '                     ▼',
    ])
  })

  test('keeps the selected node, then what is flagged, then the rest in their order', () => {
    const shown = (report: RippleReport, selected: string, columns: number): string[] =>
      drawGraph(report, selected, { columns, rows: 40 })
        .hits.map(hit => hit.id)
        .filter(hit => hit !== 'core')
    // Three fit beside the fold box, which answers for the first node it holds.
    expect(shown(wide(12), 'dependent5', 64)).toEqual(['dependent0', 'dependent5', 'dependent11', 'dependent1'])
    // From the change every dependent is linked, so what breaks comes before the first in line.
    expect(shown(wide(12), 'core', 60)).toEqual(['dependent0', 'dependent11', 'dependent1'])
  })

  test('what the selected node is linked to is kept before a flagged node it is not linked to', () => {
    const report = wide(12)
    report.nodes.push(node('page', { depth: 2 }))
    report.edges.push({ from: 'page', to: 'dependent7' })
    const shown = drawGraph(report, 'page', { columns: 46, rows: 40 }).hits.map(hit => hit.id)
    expect(shown).toContain('dependent7')
    expect(shown).not.toContain('dependent11')
  })

  test('the fold box takes the color of the worst it holds, and a click on it selects the first node inside', () => {
    expect(spansWith(drawGraph(wide(12), 'core', { columns: 60, rows: 40 }), 'more')).toEqual([
      { text: '+10 more', paint: 'dim' },
    ])
    const allBreak = drawGraph(wide(12, 12), 'core', { columns: 60, rows: 40 })
    expect(spansWith(allBreak, 'more')).toEqual([{ text: '+10 more', paint: 'breaks' }])
    const hit = allBreak.hits.find(one => one.id === 'dependent2')
    expect(picture(allBreak)[(hit?.y ?? 0) + 1]?.slice(hit?.x, (hit?.x ?? 0) + (hit?.width ?? 0))).toBe('╎ +10 more ╎')
    // Selecting it brings it out of the fold.
    expect(spansWith(allBreak, 'dependent2')).toHaveLength(0)
    expect(spansWith(drawGraph(wide(12, 12), 'dependent2', { columns: 60, rows: 40 }), 'dependent2')).toHaveLength(1)
  })

  test('nothing is ever drawn past the room, and no two boxes share a cell, at any width the graph is drawn in', () => {
    for (const columns of [GRAPH_COLUMNS, 41, 47, 59, 72, 100, 160]) {
      for (const report of [SHOP_MAP, wide(1), wide(25), wide(25, 25)]) {
        const drawing = drawGraph(report, 'core', { columns, rows: 40 })
        expect(Math.max(...picture(drawing).map(row => row.length))).toBeLessThanOrEqual(columns)
        for (const hit of drawing.hits) {
          expect(hit.x).toBeGreaterThanOrEqual(0)
          expect(hit.x + hit.width).toBeLessThanOrEqual(columns)
        }
        const cells = drawing.hits.flatMap(hit =>
          Array.from({ length: hit.width }, (_, index) => `${hit.x + index},${hit.y}`),
        )
        expect(new Set(cells).size).toBe(cells.length)
      }
    }
  })

  test('a name too long for a box is cut, so the widest box still leaves room for the fold box', () => {
    const long = wide(3)
    long.nodes.push(node('aNameThatGoesOnAndOnWellPastAnyBox', { risk: 'breaks' }))
    long.edges.push({ from: 'aNameThatGoesOnAndOnWellPastAnyBox', to: 'core' })
    const rows = picture(drawGraph(long, 'aNameThatGoesOnAndOnWellPastAnyBox', { columns: GRAPH_COLUMNS, rows: 40 }))
    expect(rows[1]).toBe('║ ● aNameThatGoesOnAndO… ║  ╎ +3 more ╎')
  })
})

describe('a room too short for every layer', () => {
  test('keeps the layers around the selection and counts what it cut', () => {
    const bottom = drawGraph(SHOP_MAP, id('toFixed2'), { columns: 90, rows: 12 })
    expect(picture(bottom)).toEqual([
      '↑ 6 more above',
      '                                    ┌───────────────┐',
      '                                    │ ◆ formatPrice │',
      '                                    └───────┬───────┘',
      '                                   ┌────────┴─────────┐',
      '                                   ▼                  ▼',
      '                            ╔════════════╗  ┌──────────────────┐',
      '                            ║ → toFixed2 ║  │ → currencySymbol │',
      '                            ╚════════════╝  └──────────────────┘',
    ])
    const top = picture(drawGraph(SHOP_MAP, id('CheckoutPage'), { columns: 90, rows: 12 }))
    expect(top).toHaveLength(9)
    expect(top.at(-1)).toBe('↓ 3 more below')
    expect(top[1]).toContain('○ CheckoutPage')
  })

  test('grows from the selection toward the change before away from it', () => {
    const middle = picture(drawGraph(SHOP_MAP, id('renderCart'), { columns: 90, rows: 12 }))
    expect(middle.join('\n')).toContain('◆ formatPrice')
    expect(middle.join('\n')).not.toContain('CheckoutPage')
    expect(middle[0]).toBe('↑ 2 more above')
    expect(middle.at(-1)).toBe('↓ 2 more below')
  })

  test('a click on a cut line selects a node in the nearest layer it hides', () => {
    const drawing = drawGraph(SHOP_MAP, id('renderCart'), { columns: 90, rows: 12 })
    const marks = drawing.hits.filter(hit => hit.height === 1)
    expect(marks.map(hit => [hit.id, hit.y])).toEqual([
      [id('CheckoutPage'), 0],
      [id('toFixed2'), drawing.rows.length - 1],
    ])
  })

  test('even one row of room draws the selected layer whole', () => {
    const cramped = picture(drawGraph(SHOP_MAP, id('formatPrice'), { columns: 90, rows: 1 }))
    expect(cramped.join('\n')).toContain('◆ formatPrice')
    expect(cramped).toHaveLength(5)
  })
})

describe('moving the selection', () => {
  const step = (from: string, ...moves: Array<'left' | 'right' | 'up' | 'down'>): string =>
    SHOP_MAP.nodes.find(
      one => one.id === moves.reduce((at, move) => stepInGraph(SHOP_MAP, at, move), id(from)),
    )?.name ?? ''

  test('left and right walk the layer and stop at its ends', () => {
    expect(step('renderCart', 'right')).toBe('renderInvoice')
    expect(step('renderCart', 'right', 'right', 'right', 'right', 'right')).toBe('emailReceipt')
    expect(step('renderCart', 'left')).toBe('renderCart')
  })

  test('up and down follow an edge where the next layer has one', () => {
    expect(step('renderInvoice', 'up')).toBe('InvoicePage')
    expect(step('InvoicePage', 'down')).toBe('renderInvoice')
    expect(step('formatPrice', 'up')).toBe('renderCart')
    expect(step('formatPrice', 'down')).toBe('toFixed2')
  })

  test('with no edge to follow, they land on the node nearest in place', () => {
    expect(step('priceLabel', 'up')).toBe('InvoicePage')
    expect(step('emailReceipt', 'up')).toBe('InvoicePage')
  })

  test('the top and bottom layers are where they stop', () => {
    expect(step('CheckoutPage', 'up')).toBe('CheckoutPage')
    expect(step('currencySymbol', 'down')).toBe('currencySymbol')
  })
})
