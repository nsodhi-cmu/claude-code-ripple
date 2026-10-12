# The Views

The pane draws the map two ways in a terminal, as a graph and as a tree, and as a ring picture everywhere else. The graph is `ripple/hooks/graph.ts`, the tree `ripple/hooks/tree.ts`, and the rings `ripple/hooks/web.ts`. What is selected and how the keys move it is `ripple/hooks/view.ts`.

## Drawings

Both terminal views return a `Drawing` (`ripple/hooks/draw.ts`): rows of painted text, and hits. A hit is a rectangle of cells and the node a click inside it selects. A paint names what a run of text is (`changed`, `breaks`, `review`, `accent`, `dim`, or `plain`), and the pane gives each one a color from the person's theme.

A drawing is plain data, and nothing that makes one touches the engine. That is what lets the tests compare a whole picture with the one expected.

## The Graph

`layersOf` sorts the nodes into layers by rank: the farthest dependents first, the changed symbols in the middle, the dependencies last. Each layer is ordered by where its nodes' links sit in the layer nearer the change, which keeps edges from crossing.

`drawGraph` then fits the layers into the room it is given.

- **Across.** A layer that does not fit keeps the selected node first, then what the selected node is linked to, then the rest; within each of those, what breaks comes before what needs review, before everything else. What is left is folded into one box that counts it and takes the color of the worst it holds. A click on that box selects the first node inside, which brings it out.
- **Down.** When the layers do not all fit, the ones around the selected layer are kept, growing toward the change first. A line at the top or the bottom counts the nodes cut, and a click on it selects a node in the nearest hidden layer.
- **Seating.** The layer nearest the change is centered. Every other layer is seated against the one it was ordered by: each box as near as it can be to the middle of the boxes it is linked to, then the boxes are pushed apart and the layer slid back toward where it wanted to be.

Edges are drawn between neighboring layers only. All the edges between two layers share one row, where they meet in box-drawing junctions; an edge runs straight down where the box above reaches over the one below. The edges of a folded node are drawn to the fold box.

The selected box has a double frame, and the edges that touch it are painted `accent`.

A room narrower than `GRAPH_COLUMNS` or shorter than `GRAPH_ROWS` has no graph: `modeIn` answers the tree for it.

## The Tree

`treeOf` gives one row a node. Each changed symbol heads a tree: its dependents hang under it, each under the first node one step nearer the change that it uses, and after them what the changed symbol uses. A node linked to nothing is a root of its own, after the changed ones.

A row is the node's mark and name, where it is, and what to know of it: how a changed symbol changed, a dependent's risk, and `untested`. A tree too tall for the room keeps the rows around the selected one between two lines that count the rest.

## The Selection

One node is selected. `selectedOf` answers the one the view names while the map still holds it; otherwise a reader starts on the first node that breaks, then the first that needs review, then the first changed symbol.

| Key | In the graph | In the tree |
| :- | :- | :- |
| `h`, left | The node to the left in the layer. | The node this row hangs under. |
| `l`, right | The node to the right in the layer. | The first node that hangs under this row. |
| `k`, up | The layer above: a node that uses this one, else the nearest in place. | The row above. |
| `j`, down | The layer below: a node this one uses, else the nearest in place. | The row below. |
| `n` | The next flagged node, round and round. | The same. |

A new map starts the selection over.

## The Pane

The `ui.render` hook in `ripple/hooks/register.tsx` draws the pane. In a terminal it holds, top to bottom: the header, which changes the map is of and how they were traced, the mapper's summary, a notice while a mapper is at work or once the changes have moved on, the legend, the map, the detail of the selected node, and the keys.

`planOf` shares the pane's rows out. A pane with fewer than `ROOMY_ROWS` rows keeps only the header, the notice, the map, one line each for the selected node and its verdict, and the keys.

The map itself is drawn by a surface module, `ripple/hooks/pane.tsx`, because only a surface module is handed pointer events and the arrow keys. It paints the drawing it is given and posts two things to the hooks module: the node a click landed on, and each key pressed while it holds the keyboard. The hooks module keeps the view, in the session state `ripple.view`, and decides what a click or a key does. The letter keys are Buttons the hooks module draws under the map, which work whenever the pane has the keyboard; the arrow keys reach the map only after a click on it.

The `view` option in the plugin's manifest picks the view a map opens in. The `t` key switches for the rest of the session.

## The Rings

`ringSvg` draws the map as an SVG: the changed symbols at the center, their dependencies on a dashed inner ring, direct dependents on the next ring, and farther ones on the outer ring, each beside the dependent it uses. It is what the desktop app, the VS Code extension, and the mobile app show in the pane, and what `graphHtml` puts on the page `/ripple web` writes, over a key to every mark.
