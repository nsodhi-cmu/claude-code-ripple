# The Views

The pane draws the map two ways in a terminal, as a graph and as a tree, and as a ring picture everywhere else. Both terminal views draw it [by file](MAP.md#by-file), with the symbols of the selected file listed under them. The graph is drawn by [graphlet](https://github.com/nsodhi-cmu/claude-code-graphlet), a mod for drawing graphs that Ripple depends on; the tree and the list are Ripple's own.

| File | What it is |
| :- | :- |
| `ripple/hooks/files.ts` | The map by file. |
| `ripple/hooks/graph.ts` | The map as a graph, for graphlet to draw. |
| `ripple/hooks/tree.ts` | The tree view. |
| `ripple/hooks/list.ts` | The list of the selected file's symbols. |
| `ripple/hooks/draw.ts` | What the tree and the list draw with. |
| `ripple/hooks/view.ts` | Which view, which symbol is selected, and how the pane's rows are shared out. |
| `ripple/hooks/rings.ts` | The rings. |

## Drawings

The tree and the list each return a `Drawing`: rows of painted text, and hits. A hit is a rectangle of cells and what a click inside it does: selects a symbol, or scrolls the map. A paint names what a run of text is (`changed`, `breaks`, `review`, `accent`, `dim`, or `plain`), and the pane gives each one a color from the person's theme. What changed and is itself at risk keeps the changed mark and takes the risk's paint.

A drawing is plain data, and nothing that makes one touches the engine. That is what lets the tests compare a whole picture with the one expected.

## Windows

A map can be larger than the room the pane has for it, so it is drawn through a window. The tree is a `View`, which is these functions; graphlet answers the same four of the graph.

| Function | What it answers |
| :- | :- |
| `draw` | The map as seen through a window at `pan`. |
| `show` | Where the window stands to show the selected file. |
| `scroll` | Where the window stands after it is scrolled, by cells or by turns of the wheel. |
| `step` | The symbol a move from the selected file lands on. |

These hold of both views.

- **The layout does not depend on the selection.** Where a file is drawn depends on the map and the room alone. Selecting a file marks it and, where it was out of view, moves the window.
- **The window moves no farther than it must.** `show` is built on `reveal`. A window that already shows the selected file whole stays where it is, even with the file at its edge. One that does not moves just far enough to show the file and a little past it: in the graph the links above and below the box and the start of the boxes beside it, in the tree the next row.
- **What is out of view is counted.** A view that does not fit ends in a row that counts the files not wholly in view past each edge of the window, the sides' counts at the sides and the counts above and below between them. A click on a count scrolls that way: most of a room of the graph, and a window's worth of the tree.

The window stands where the person scrolled it until another file is selected, and then goes back to following the selection.

## The Graph

`graphOf` in `ripple/hooks/graph.ts` turns the map by file into a graph as graphlet takes one.

| Of a node | What Ripple gives it |
| :- | :- |
| `id` | The file's path. |
| `label` | The file's name. |
| `mark` | The file's mark: `◆`, `●`, `▲`, `○`, or `→`. |
| `tone` | The paint of that mark, as graphlet names tones: `note` for what changed, `bad` for what breaks, `warn` for what needs review, `dim` for what the change uses. |
| `badge` | How many of the map's symbols the file holds, when more than one. |
| `layer` | The file's rank: the files that use the change counted upward from it, and the files it uses downward. |

A link runs from a file to a file it uses. So the farthest files that use the change are the top layer, the changed files are in the middle, and the files they use are at the bottom, and a link that runs back up the map, as where two files use each other, is one graphlet draws dashed.

Everything about the picture is graphlet's: how the layers are ordered and laid out, how a long name is wrapped, how links are routed, how a graph larger than its room scrolls, and the settings for each. Its [docs](https://github.com/nsodhi-cmu/claude-code-graphlet/tree/main/docs) describe them.

The pane's `ui.render` hook asks graphlet how many rows the graph needs, shares the pane's rows out, tells graphlet what the pane holds and which file is selected, and places the drawing that `next(e)` hands it. Ripple keeps the selection, since it is a symbol and not a file, and graphlet says what the person did:

- A hook on `graphlet.select` hears a click on a box, or an arrow key over the graph, and selects that file.
- A hook on `graphlet.key` hears every other key pressed over the graph, and does what the pane's own key does.
- `h` `j` `k` `l` ask `$.graphlet.step` where the move lands, and a turn of the wheel over the graph is passed to `$.graphlet.scroll`.

A room narrower than `GRAPH_COLUMNS` or shorter than `GRAPH_ROWS` has no graph: `modeIn` answers the tree for it.

## The Tree

`treeOf` gives one row a file. Each changed file heads a tree: the files that use it hang under it, each under the first file one step nearer the change that it uses, and after them the files it uses. A file linked to nothing is a root of its own, after the changed ones.

A row is the file's mark and path, the folder dim, and then the names of its symbols in a column. A path too long for the room loses its start, so the file's own name stays, and a row that still runs past the room ends in an ellipsis. The window moves by rows.

## The List

`drawList` draws the selected file's symbols, a row each: its mark, its name, its line, and what to know of it, which is how a changed symbol changed, the risk of a flagged one, and `untested`. The selected symbol's name is marked.

The list has a fixed number of rows. With more symbols than rows, the line over it says which it shows, as `symbols 3–5 of 9`, and the first and last rows are marked where there are more above and below. It scrolls as the map does: no farther than shows the selected symbol, and by the wheel without moving the selection.

## The Selection

The selection is a symbol's id, and the selected file is the one that holds it. Selecting a file selects its first symbol, or the one already selected when the file was.

`selectedOf` answers the symbol the view names while the map still holds it; otherwise a reader starts on the first symbol that breaks, then the first that needs review, then the first changed one.

| Key | In the graph, as graphlet answers | In the tree |
| :- | :- | :- |
| `h`, left | The file to the left in the layer. | The file this row hangs under. |
| `l`, right | The file to the right in the layer. | The first file that hangs under this row. |
| `k`, up | A file above that is linked to this one, the nearest; with none, the nearest file of the layer above. | The row above. |
| `j`, down | A file below that is linked to this one, the nearest; with none, the nearest file of the layer below. | The row below. |
| `u`, `d` | The symbol above and below in the list. | The same. |
| `n` | The next flagged symbol, and after the last the first again. | The same. |

A new map starts the selection over.

The keys that start something are digits: `1` asks Claude about the selected symbol, and `2` maps the same scope and focus again. A prompt typed while the pane has the keyboard cannot set one off with its first letter.

## The Pane

The `ui.render` hook in `ripple/hooks/register.tsx` draws the pane. In a terminal it holds, top to bottom: the header, which changes the map is of and how they were traced, the mapper's summary, a notice while a mapper is at work or once the changes have moved on, the legend, the map, the selected file's path over the list of its symbols, what the selected symbol is and the mapper's reason for it, and the keys.

`planOf` shares the pane's rows out. It counts the summary as it wraps and the legend and the keys as they flow across the pane's width. The list and the lines under it share a box of one height, with room for as many rows as the map's fullest file has symbols, up to a limit. So the map, the list, and the keys keep their places as the selection moves, and the lines about the selected symbol follow the last row of the list.

A pane says everything around the map where that still leaves the map the rows it needs to be drawn whole, or `ROOMY_MAP_ROWS` of them. Otherwise it keeps only the header, the notice, the map, a shorter list, one row for the reason, and the keys, so a taller pane never shows less of the map than a shorter one.

The tree and the list are each drawn by a surface module, `ripple/hooks/pane.tsx`, because only a surface module is handed pointer events and the arrow keys; the graph is drawn by graphlet's. Ripple's paints the drawing it is given and posts what the person did: the hit a click landed on, and each key pressed while it holds the keyboard. The hooks module keeps the view in the session state `ripple.view`: the mode, the selected symbol, and where the person scrolled the tree and the list to, which is null while they follow the selection. Where the graph's window stands is graphlet's to keep. The hooks module decides what a click or a key does. In the list, the up and down arrows go through the symbols.

The wheel reaches the hooks module as `ui.scroll`, with the row of the pane it was over. A turn over the map scrolls the map, the graph through graphlet, and one over the list or below it scrolls the list. When the pane is too short for all it draws, the turn is left to the engine, which scrolls the pane.

The keys are Buttons the hooks module draws under the list, which work whenever the pane has the keyboard; the arrow keys reach the map or the list only after a click on it. A press is answered by a `ui.press` hook and not by the Button's own closure, which the engine runs beneath the mod's hooks: a mapper started from there would not be the mod's to guard. The pane asks for the keyboard when the person opens it, and not when a map arrives.

The `view` option in the plugin's manifest picks the view a map opens in, and the `t` key switches for the rest of the session. The two views are drawn by different mods, so the switch takes the keyboard from the drawing that had it, and the pane asks for it back.

## The Rings

`ringSvg` draws the map as an SVG, a symbol a dot: the changed symbols at the center, their dependencies on a dashed inner ring, direct dependents on the next ring, and farther ones on the outer ring, each beside the dependent it uses. It is what the desktop app, the VS Code extension, and the mobile app show in the pane, over a button that maps again: those surfaces have no selection and no list.
