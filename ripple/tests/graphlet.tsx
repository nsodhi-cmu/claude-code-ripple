import type { Plugin } from 'claude-code/testing'

/**
 * Stands in for graphlet, the mod that draws the graph. Where the graph goes
 * it draws one line of text, `graphlet` and then what the pane last handed it,
 * and a Button a node, whose press is the person picking that node, and a
 * Button for each of a few keys, whose press is that key pressed over the
 * graph. A move steps along the order the nodes were given in, and up and
 * down a link. In a room 66 columns wide it fails.
 */
export const GRAPHLET: Plugin = {
  name: 'graphlet',
  tier: 'append',
  register(on) {
    type Shown = {
      pane: string
      graph: { nodes: Array<{ id: string }>; links: Array<{ from: string; to: string }> }
      columns: number
      rows: number
      selected?: string
    }
    /** The rows the stand-in says any graph needs, and takes of the room it is given. */
    const ROWS = 18
    /** The one width of room the stand-in fails in, as a mod with a fault would. */
    const BROKEN_COLUMNS = 66
    const shown = new Map<string, Shown>()

    on('engine.create', async (_, e, next) => {
      const built = await next(e)
      return {
        ...built,
        graphlet: {
          measure: async (input: { columns: number }) => {
            if (input.columns === BROKEN_COLUMNS) throw new Error('graphlet is broken')
            return { columns: input.columns, rows: ROWS }
          },
          show: async (input: Shown) => {
            shown.set(input.pane, input)
            return { rows: Math.min(ROWS, input.rows), selected: input.selected ?? null }
          },
          step: async (input: { pane: string; move: string }) => {
            const at = shown.get(input.pane)
            if (at === undefined) return null
            const ids = at.graph.nodes.map(node => node.id)
            const along = input.move === 'left' ? -1 : input.move === 'right' ? 1 : 0
            const link = at.graph.links.find(one => (input.move === 'down' ? one.from : one.to) === at.selected)
            const to = along !== 0 ? ids[ids.indexOf(at.selected ?? '') + along] : input.move === 'down' ? link?.to : link?.from
            return to ?? at.selected ?? null
          },
          scroll: async () => undefined,
          select: async () => undefined,
          key: async () => undefined,
        },
      }
    })

    on('ui.render', { component: 'Pane' }, async ($, e, next) => {
      const at = shown.get(e.requestId)
      if (at === undefined) return next(e)
      const { Box, Text, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text>{`graphlet ${JSON.stringify(at)}`}</Text>
          {at.graph.nodes.map(node => (
            <Button key={`node:${node.id}`} label={node.id} onPress={() => undefined} />
          ))}
          {[...'nt'].map(key => (
            <Button key={`key:${key}`} label={key} onPress={() => undefined} />
          ))}
        </Box>
      )
    })

    on('ui.press', { plugin: 'graphlet' }, async ($, e) => {
      if (e.element.startsWith('node:')) await $.graphlet.select({ pane: e.requestId, node: e.element.slice(5) })
      if (e.element.startsWith('key:')) await $.graphlet.key({ pane: e.requestId, key: e.element.slice(4) })
      return { element: e.element }
    })
  },
}
