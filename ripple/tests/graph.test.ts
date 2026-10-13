import { describe, expect, test } from 'claude-code/testing'

import type { RippleNode, RippleReport } from '../types'
import { SHOP_MAP } from './fixture'
import { rowText } from '../hooks/draw'
import type { Drawing, Hit, Move, Pan, Span } from '../hooks/draw'
import { filesOf } from '../hooks/files'
import type { FileMap } from '../hooks/files'
import { GRAPH_COLUMNS, GRAPH_ROWS, graphView, layersOf } from '../hooks/graph'

const SHOP = filesOf(SHOP_MAP)
const graph = graphView('pinned')
const sheet = graphView('sheet')

const ORIGIN: Pan = { x: 0, y: 0 }
/** A room the shop's graph fits whole, one too narrow for its longest layer, and one too short for its layers. */
const WHOLE = { columns: 90, rows: 40 }
const NARROW = { columns: 44, rows: 40 }
const SHORT = { columns: 90, rows: 12 }

const id = (name: string): string => {
  const found = SHOP_MAP.nodes.find(node => node.name === name)
  if (found === undefined) throw new Error(`no symbol ${name}`)
  return found.id
}

const picture = (drawing: Drawing): string[] => drawing.rows.map(rowText)

/** Every span of the drawing whose text holds `text`. */
const spansWith = (drawing: Drawing, text: string): Span[] =>
  drawing.rows.flatMap(row => row.filter(span => span.text.includes(text)))

/** The hits that select a symbol, each as the symbol it selects and where its box stands. */
const boxes = (drawing: Drawing): Array<[id: string, x: number, y: number, width: number]> =>
  drawing.hits.flatMap(hit => ('id' in hit ? [[hit.id, hit.x, hit.y, hit.width] as [string, number, number, number]] : []))

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

/** One changed file and `count` files that use it, the last of them breaking. */
const wide = (count: number): FileMap => {
  const users = Array.from({ length: count }, (_, index) =>
    node(`user${index}`, index === count - 1 ? { risk: 'breaks', reason: 'gone' } : {}),
  )
  return filesOf({ method: 'grep', nodes: [CORE, ...users], edges: users.map(user => ({ from: user.id, to: 'core' })) })
}

describe('layers', () => {
  const names = (map: FileMap): string[][] => layersOf(map).map(layer => layer.map(file => file.name))

  test('they run from the farthest files that use the change down to the files it uses', () => {
    expect(names(SHOP)).toEqual([
      ['checkout.ts', 'pages/invoice.ts'],
      ['cart.ts', 'src/invoice.ts', 'ui.ts', 'email.ts'],
      ['price.ts'],
      ['money.ts'],
    ])
  })

  test('a layer is ordered by what it is linked to in the layer nearer the change, so links do not cross', () => {
    const crossed: RippleReport = {
      method: 'lsp',
      nodes: [
        CORE,
        node('left'),
        node('right'),
        node('usesRight', { depth: 2 }),
        node('usesLeft', { depth: 2 }),
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
    expect(names(filesOf(crossed))).toEqual([
      ['usesLeft.ts', 'usesRight.ts'],
      ['left.ts', 'right.ts'],
      ['core.ts'],
      ['usedSecond.ts', 'usedFirst.ts'],
      ['deeper.ts'],
    ])
  })

  test('files that pull the same way keep the order the map names them in, whatever is flagged', () => {
    expect(names(wide(5))[0]).toEqual(['user0.ts', 'user1.ts', 'user2.ts', 'user3.ts', 'user4.ts'])
  })
})

describe('the drawing', () => {
  test('a box a file, in layers, each over what it uses, with the links between them', () => {
    expect(picture(graph.draw(SHOP, id('renderInvoice'), WHOLE, ORIGIN))).toEqual([
      '          ┌───────────────┐  ┌────────────────────┐',
      '          │ ○ checkout.ts │  │ ○ pages/invoice.ts │',
      '          └────────┬──────┘  └────────┬───────────┘',
      '                   │                  │',
      '                   ▼                  ▼',
      '             ┌───────────┐  ╔══════════════════╗  ┌─────────┐  ┌────────────┐',
      '             │ ● cart.ts │  ║ ● src/invoice.ts ║  │ ○ ui.ts │  │ ▲ email.ts │',
      '             └─────┬─────┘  ╚════════════════╤═╝  └────┬────┘  └──────┬─────┘',
      '                   └─────────────────────────┼─────────┴──────────────┘',
      '                                             ▼',
      '                                      ┌────────────┐',
      '                                      │ ◆ price.ts │',
      '                                      └──────┬─────┘',
      '                                             │',
      '                                             ▼',
      '                                     ┌───────────────┐',
      '                                     │ → money.ts  2 │',
      '                                     └───────────────┘',
    ])
  })

  test('the selected box, the boxes linked to it, and the links between them are lit; the rest keep their own paint', () => {
    const drawing = graph.draw(SHOP, id('renderInvoice'), WHOLE, ORIGIN)
    expect(spansWith(drawing, '● src/invoice.ts')).toEqual([
      { text: '● src/invoice.ts', paint: 'breaks', isBold: true, isInverse: true },
    ])
    expect(drawing.rows[0]?.filter(span => span.text.includes('┌')).map(span => span.paint)).toEqual(['dim', 'accent'])
    expect(drawing.rows[5]?.filter(span => span.text.trim() !== '').map(span => span.paint)).toEqual([
      'breaks',
      'accent',
      'dim',
      'review',
    ])
    expect(spansWith(drawing, '┌────────────┐').at(-1)?.paint).toBe('accent')
    expect(drawing.rows[4]?.filter(span => span.text === '▼').map(span => span.paint)).toEqual(['dim', 'accent'])
    expect(drawing.rows[8]?.filter(span => span.text.trim() !== '').map(span => [span.text.length, span.paint])).toEqual([
      [26, 'dim'],
      [1, 'accent'],
      [25, 'dim'],
    ])
    expect(spansWith(drawing, '● cart.ts')).toEqual([{ text: '● cart.ts', paint: 'breaks' }])
  })

  test('a box that holds more than one symbol counts them after its name, apart from the name', () => {
    const drawing = graph.draw(SHOP, id('toFixed2'), WHOLE, ORIGIN)
    expect(drawing.rows[16]?.filter(span => span.text.trim() !== '').slice(1, 3)).toEqual([
      { text: '→ money.ts', paint: 'dim', isBold: true, isInverse: true },
      { text: '  2', paint: 'dim' },
    ])
    expect(spansWith(drawing, 'price.ts')).toEqual([{ text: '◆ price.ts', paint: 'changed' }])
  })

  test('every box is a hit over exactly its own cells, and no two hits overlap', () => {
    const drawing = graph.draw(SHOP, id('renderCart'), WHOLE, ORIGIN)
    const rows = picture(drawing)
    expect(boxes(drawing).map(([symbol]) => symbol)).toEqual([
      id('CheckoutPage'),
      id('InvoicePage'),
      id('renderCart'),
      id('renderInvoice'),
      id('priceLabel'),
      id('emailReceipt'),
      id('formatPrice'),
      id('currencySymbol'),
    ])
    for (const [, x, y, width] of boxes(drawing)) {
      expect('┌╔').toContain(rows[y]?.[x] ?? ' ')
      expect('┘╝').toContain(rows[y + 2]?.[x + width - 1] ?? ' ')
    }
    const cells = boxes(drawing).flatMap(([, x, y, width]) =>
      Array.from({ length: width * 3 }, (_, index) => `${x + (index % width)},${y + Math.floor(index / width)}`),
    )
    expect(new Set(cells).size).toBe(cells.length)
  })

  test('a click on a box selects its first symbol, and on the selected file\'s box the symbol already selected', () => {
    const money = (selected: string): string | undefined =>
      boxes(graph.draw(SHOP, selected, WHOLE, ORIGIN))
        .map(([symbol]) => symbol)
        .find(symbol => symbol.startsWith('src/money.ts:'))
    expect(money(id('renderCart'))).toBe(id('currencySymbol'))
    expect(money(id('toFixed2'))).toBe(id('toFixed2'))
  })

  test('an empty map draws nothing', () => {
    expect(graph.draw({ files: [], links: [] }, null, WHOLE, ORIGIN)).toEqual({ rows: [], hits: [] })
  })

  test('a name too long for a box is cut in its middle', () => {
    const long = filesOf({
      method: 'grep',
      nodes: [node('core', { role: 'changed', depth: 0, file: 'src/subscription-renewal-manager.test.ts' })],
      edges: [],
    })
    expect(picture(graph.draw(long, null, WHOLE, ORIGIN))[1]?.trim()).toBe('│ ◆ subscription-ren…manager.test.ts │')
  })

  test('names that differ only in their middle are still told apart in their boxes', () => {
    const alike = filesOf({
      method: 'grep',
      nodes: ['item', 'list', 'menu'].map(part =>
        node(part, { role: 'changed', depth: 0, file: `src/shopping-cart-${part}.component.ts` }),
      ),
      edges: [],
    })
    expect(picture(graph.draw(alike, null, { columns: 120, rows: 40 }, ORIGIN))[1]?.trim()).toBe(
      '│ ◆ shopping-cart-item.component.ts │  │ ◆ shopping-cart-list.component.ts │  │ ◆ shopping-cart-menu.component.ts │',
    )
  })
})

describe('a layer longer than the room', () => {
  test('it keeps its order and runs off the edge, where a cut box ends in an ellipsis and a row counts the files out of view', () => {
    expect(picture(graph.draw(SHOP, id('priceLabel'), NARROW, ORIGIN))).toEqual([
      ' ┌───────────────┐  ┌────────────────────┐',
      ' │ ○ checkout.ts │  │ ○ pages/invoice.ts │',
      ' └────┬──────────┘  └────┬───────────────┘',
      '      │                  │',
      '      ▼                  ▼',
      '┌───────────┐  ┌──────────────────┐  ╔══════',
      '│ ● cart.ts │  │ ● src/invoice.ts │  ║ ○ ui…',
      '└─────┬─────┘  └──────┬───────────┘  ╚════╤═',
      '      └───────────────┼───────────────────┴─',
      '                      ▼',
      '               ┌────────────┐',
      '               │ ◆ price.ts │',
      '               └──────┬─────┘',
      '                      │',
      '                      ▼',
      '              ┌───────────────┐',
      '              │ → money.ts  2 │',
      '              └───────────────┘',
      '                                    2 more →',
    ])
  })

  test('scrolled, it slides under the window while the layers that fit stay where they are', () => {
    const start = picture(graph.draw(SHOP, id('emailReceipt'), NARROW, ORIGIN))
    const end = picture(graph.draw(SHOP, id('emailReceipt'), NARROW, { x: 20, y: 0 }))
    expect(end.slice(5, 9)).toEqual([
      '──────────────┐  ┌─────────┐  ╔════════════╗',
      '…c/invoice.ts │  │ ○ ui.ts │  ║ ▲ email.ts ║',
      '─────┬────────┘  └────┬────┘  ╚══════╤═════╝',
      '─────┴────────────────┼──────────────┘',
    ])
    expect(end.at(-1)).toBe('← 2 more')
    for (const row of [1, 11, 16]) expect(end[row]).toBe(start[row])
  })

  test('which files a window shows, and where, does not depend on which of them is selected', () => {
    const map = wide(12)
    const room = { columns: 60, rows: 40 }
    const places = (selected: string): Array<[number, number, number]> =>
      boxes(graph.draw(map, selected, room, { x: 30, y: 0 })).map(([, x, y, width]) => [x, y, width])
    expect(places('user11')).toEqual(places('user0'))
    expect(places('core')).toEqual(places('user0'))
    expect(picture(graph.draw(map, 'core', room, { x: 30, y: 0 }))[1]).toBe(
      '  │ ○ user2.ts │  │ ○ user3.ts │  │ ○ user4.ts │  │ ○ user5…',
    )
  })

  test('a window that shows the selected box whole stays where it is, though the box stands at its edge', () => {
    expect(graph.show(SHOP, id('priceLabel'), NARROW, { x: 4, y: 0 })).toEqual({ x: 4, y: 0 })
    expect(picture(graph.draw(SHOP, id('priceLabel'), NARROW, { x: 4, y: 0 }))[6]).toBe(
      '…art.ts │  │ ● src/invoice.ts │  ║ ○ ui.ts ║',
    )
  })

  test('the window moves no farther than it must to show the selected file and the start of the one past it', () => {
    const shownFor = (name: string, from: number): Pan => graph.show(SHOP, id(name), NARROW, { x: from, y: 0 })
    expect(shownFor('renderCart', 0)).toEqual({ x: 0, y: 0 })
    expect(shownFor('priceLabel', 0)).toEqual({ x: 10, y: 0 })
    expect(shownFor('emailReceipt', 0)).toEqual({ x: 20, y: 0 })
    expect(shownFor('renderInvoice', 5)).toEqual({ x: 5, y: 0 })
    expect(shownFor('renderInvoice', 20)).toEqual({ x: 9, y: 0 })
    expect(shownFor('renderCart', 20)).toEqual({ x: 0, y: 0 })
  })

  test('a file in a layer that fits is in view wherever the window stands, so selecting it moves nothing', () => {
    expect(graph.show(SHOP, id('formatPrice'), NARROW, { x: 17, y: 0 })).toEqual({ x: 17, y: 0 })
    expect(graph.show(SHOP, id('CheckoutPage'), NARROW, { x: 17, y: 0 })).toEqual({ x: 17, y: 0 })
  })

  test('a click on a count scrolls most of a room that way, and no farther than the map goes', () => {
    const count = graph.draw(SHOP, id('priceLabel'), NARROW, ORIGIN).hits.find((hit): hit is Hit & { by: Pan } => 'by' in hit)
    expect(count).toEqual({ x: 36, y: 18, width: 8, height: 1, by: { x: 28, y: 0 } })
    expect(graph.scroll(SHOP, NARROW, ORIGIN, { x: 28, y: 0 })).toEqual({ x: 20, y: 0 })
    expect(graph.scroll(SHOP, NARROW, { x: 20, y: 0 }, { x: -28, y: 0 })).toEqual(ORIGIN)
  })

  test('the wheel goes along a map that is longer than the room, and down one that is taller', () => {
    expect(graph.scroll(SHOP, NARROW, ORIGIN, 1)).toEqual({ x: 8, y: 0 })
    expect(graph.scroll(SHOP, NARROW, { x: 8, y: 0 }, -1)).toEqual(ORIGIN)
    expect(graph.scroll(SHOP, NARROW, ORIGIN, 9)).toEqual({ x: 20, y: 0 })
    expect(graph.scroll(SHOP, SHORT, ORIGIN, 1)).toEqual({ x: 0, y: 2 })
    expect(graph.scroll(SHOP, WHOLE, ORIGIN, 3)).toEqual(ORIGIN)
  })

  test('nothing is drawn past the room, every hit lies in it, and no two boxes share a cell, at any width and wherever the window stands', () => {
    const maps: Array<[FileMap, string]> = [
      [SHOP, id('emailReceipt')],
      [wide(1), 'core'],
      [wide(25), 'user12'],
    ]
    for (const view of [graph, sheet]) {
      for (const columns of [GRAPH_COLUMNS, 41, 47, 59, 72, 100, 160]) {
        for (const [map, selected] of maps) {
          for (const x of [0, 7, 33, 400]) {
            const room = { columns, rows: 14 }
            const drawing = view.draw(map, selected, room, { x, y: 3 })
            expect(Math.max(...picture(drawing).map(row => row.length))).toBeLessThanOrEqual(columns)
            expect(drawing.rows.length).toBeLessThanOrEqual(room.rows)
            for (const hit of drawing.hits) {
              expect(hit.x).toBeGreaterThanOrEqual(0)
              expect(hit.y).toBeGreaterThanOrEqual(0)
              expect(hit.x + hit.width).toBeLessThanOrEqual(columns)
              expect(hit.y + hit.height).toBeLessThanOrEqual(drawing.rows.length)
            }
            const cells = boxes(drawing).flatMap(([, left, y, width]) =>
              Array.from({ length: width }, (_, index) => `${left + index},${y}`),
            )
            expect(new Set(cells).size).toBe(cells.length)
          }
        }
      }
    }
  })
})

describe('laid on one sheet', () => {
  test('every layer lies across the longest, each box by what it is linked to, and all of them move together', () => {
    expect(picture(sheet.draw(SHOP, id('renderCart'), NARROW, ORIGIN))).toEqual([
      '┌───────────────┐  ┌────────────────────┐',
      '│ ○ checkout.ts │  │ ○ pages/invoice.ts │',
      '└─────┬─────────┘  └─────┬──────────────┘',
      '      │                  │',
      '      ▼                  ▼',
      '╔═══════════╗  ┌──────────────────┐  ┌──────',
      '║ ● cart.ts ║  │ ● src/invoice.ts │  │ ○ ui…',
      '╚═════╤═════╝  └────────────────┬─┘  └────┬─',
      '      └─────────────────────────┼─────────┴─',
      '                                ▼',
      '                         ┌────────────┐',
      '                         │ ◆ price.ts │',
      '                         └──────┬─────┘',
      '                                │',
      '                                ▼',
      '                        ┌───────────────┐',
      '                        │ → money.ts  2 │',
      '                        └───────────────┘',
      '                                    2 more →',
    ])
    const rightEdges = (x: number): Map<string, number> =>
      new Map(boxes(sheet.draw(SHOP, id('renderCart'), NARROW, { x, y: 0 })).map(([symbol, left, , width]) => [symbol, left + width]))
    const [before, after] = [rightEdges(0), rightEdges(12)]
    for (const name of ['CheckoutPage', 'InvoicePage', 'renderCart', 'renderInvoice', 'formatPrice', 'currencySymbol']) {
      expect(after.get(id(name))).toBe((before.get(id(name)) ?? 0) - 12)
    }
  })

  test('the window goes to the selected file wherever on the sheet it is', () => {
    expect(sheet.show(SHOP, id('emailReceipt'), NARROW, ORIGIN)).toEqual({ x: 20, y: 0 })
    expect(sheet.show(SHOP, id('formatPrice'), NARROW, { x: 20, y: 0 })).toEqual({ x: 20, y: 0 })
    expect(sheet.show(SHOP, id('CheckoutPage'), NARROW, { x: 20, y: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('a room too short for every layer', () => {
  test('the window shows the selected layer with its links, and the row under it counts the files above and below', () => {
    expect(picture(graph.draw(SHOP, id('toFixed2'), SHORT, graph.show(SHOP, id('toFixed2'), SHORT, ORIGIN)))).toEqual([
      '             └─────┬─────┘  └────────────────┬─┘  └────┬────┘  └──────┬─────┘',
      '                   └─────────────────────────┼─────────┴──────────────┘',
      '                                             ▼',
      '                                      ┌────────────┐',
      '                                      │ ◆ price.ts │',
      '                                      └──────┬─────┘',
      '                                             │',
      '                                             ▼',
      '                                     ╔═══════════════╗',
      '                                     ║ → money.ts  2 ║',
      '                                     ╚═══════════════╝',
      '                                         ↑ 6 more',
    ])
    const top = picture(graph.draw(SHOP, id('CheckoutPage'), SHORT, graph.show(SHOP, id('CheckoutPage'), SHORT, ORIGIN)))
    expect(top[1]).toContain('○ checkout.ts')
    expect(top.at(-1)?.trim()).toBe('↓ 2 more')
  })

  test('moving a layer down shows that layer and the links on both sides of it', () => {
    const shownFor = (name: string, from: number): number => graph.show(SHOP, id(name), SHORT, { x: 0, y: from }).y
    expect(shownFor('CheckoutPage', 0)).toBe(0)
    expect(shownFor('renderCart', 0)).toBe(0)
    expect(shownFor('formatPrice', 0)).toBe(4)
    expect(shownFor('toFixed2', 4)).toBe(7)
    expect(shownFor('renderCart', 7)).toBe(3)
  })

  test('the shortest room the graph is drawn in holds two layers, their links, and the count', () => {
    const rows = picture(graph.draw(SHOP, id('CheckoutPage'), { columns: 90, rows: GRAPH_ROWS }, ORIGIN))
    expect(rows).toHaveLength(GRAPH_ROWS)
    expect(rows[6]).toContain('│ ● cart.ts │')
    expect(rows.at(-1)?.trim()).toBe('↓ 2 more')
  })
})

describe('moving the selection', () => {
  const step = (view: typeof graph, room: typeof WHOLE, pan: Pan, from: string, ...moves: Move[]): string =>
    SHOP_MAP.nodes.find(one => one.id === moves.reduce<string | null>((at, move) => view.step(SHOP, at, move, room, pan), id(from)))
      ?.file ?? ''
  const walk = (from: string, ...moves: Move[]): string => step(graph, WHOLE, ORIGIN, from, ...moves)

  test('left and right walk the layer and stop at its ends', () => {
    expect(walk('renderCart', 'right')).toBe('src/invoice.ts')
    expect(walk('renderCart', 'right', 'right', 'right', 'right', 'right')).toBe('src/email.ts')
    expect(walk('renderCart', 'left')).toBe('src/cart.ts')
  })

  test('up and down follow a link where the next layer has one, to the linked file nearest in the window', () => {
    expect(walk('renderInvoice', 'up')).toBe('src/pages/invoice.ts')
    expect(walk('InvoicePage', 'down')).toBe('src/invoice.ts')
    expect(walk('formatPrice', 'up')).toBe('src/invoice.ts')
    expect(walk('formatPrice', 'down')).toBe('src/money.ts')
  })

  test('with no link to follow, they land on the file nearest in the window', () => {
    expect(walk('priceLabel', 'up')).toBe('src/pages/invoice.ts')
    expect(walk('emailReceipt', 'up')).toBe('src/pages/invoice.ts')
  })

  test('nearest is by where the boxes stand in the window, so it goes with the window', () => {
    expect(step(graph, NARROW, ORIGIN, 'formatPrice', 'up')).toBe('src/invoice.ts')
    expect(step(graph, NARROW, { x: 20, y: 0 }, 'formatPrice', 'up')).toBe('src/ui.ts')
  })

  test('a move lands on the first symbol of the file it reaches', () => {
    expect(graph.step(SHOP, id('formatPrice'), 'down', WHOLE, ORIGIN)).toBe(id('currencySymbol'))
  })

  test('the top and bottom layers are where they stop', () => {
    expect(walk('CheckoutPage', 'up')).toBe('src/pages/checkout.ts')
    expect(walk('toFixed2', 'down')).toBe('src/money.ts')
    expect(graph.step(SHOP, id('toFixed2'), 'down', WHOLE, ORIGIN)).toBe(id('toFixed2'))
  })
})
