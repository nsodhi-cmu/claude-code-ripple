# The Views

The pane draws the map two ways in a terminal, as a graph and as a tree, and as a ring picture everywhere else. Both terminal views draw it [by file](MAP.md#by-file), with the symbols of the selected file listed under them.

| File | What it is |
| :- | :- |
| `ripple/hooks/files.ts` | The map by file. |
| `ripple/hooks/graph.ts` | The graph view. |
| `ripple/hooks/tree.ts` | The tree view. |
| `ripple/hooks/list.ts` | The list of the selected file's symbols. |
| `ripple/hooks/draw.ts` | What all three draw with. |
| `ripple/hooks/view.ts` | Which view, which symbol is selected, and how the pane's rows are shared out. |
| `ripple/hooks/web.ts` | The rings. |

## Drawings

A view returns a `Drawing`: rows of painted text, and hits. A hit is a rectangle of cells and what a click inside it does: selects a symbol, or scrolls the map. A paint names what a run of text is (`changed`, `breaks`, `review`, `accent`, `dim`, or `plain`), and the pane gives each one a color from the person's theme. What changed and is itself at risk keeps the changed mark and takes the risk's paint.

A drawing is plain data, and nothing that makes one touches the engine. That is what lets the tests compare a whole picture with the one expected.

## Windows

A map can be larger than the room the pane has for it, so each view is drawn through a window. A `View` is these functions.

| Function | What it answers |
| :- | :- |
| `draw` | The map as seen through a window at `pan`. |
| `show` | Where the window stands to show the selected file. |
| `scroll` | Where the window stands after it is scrolled, by cells or by turns of the wheel. |
| `step` | The symbol a move from the selected file lands on. |

These hold of both views.

- **The layout does not depend on the selection.** Where a file is drawn depends on the map and the room alone. Selecting a file marks it and, where it was out of view, moves the window.
- **The window moves no farther than it must.** `show` is built on `reveal`, which leaves a window that already shows something where it is, and otherwise moves it just far enough. The graph keeps the gap after the selected box and the start of the next box in view with it; the tree keeps the next row.
- **What is out of view is counted.** A view that does not fit ends in a row that counts the files past each edge of the window, the sides' counts at the sides and the counts above and below between them. A click on a count scrolls most of a room that way.

The window stands where the person scrolled it until the selection next moves from file to file, and then goes back to following the selection.

## The Graph

`layersOf` sorts the files into layers by rank: the farthest files that use the change first, the changed files in the middle, the files they use last. Each layer is ordered by where its files' links sit in the layer nearer the change, so that links cross less, and files that tie keep the order the map names them in.

A box is a border, a label, and a border. The label is the file's mark and name, and a count of its symbols when it holds more than one. A name too long for a box is cut in its middle, which keeps how it starts and its extension. Between two layers are a row the links run along, where they meet in box-drawing junctions, and a row of arrowheads. A link runs straight down where the box above reaches over the one below.

The `scroll` option picks how the layers are laid out across.

- **`pinned`.** A layer that fits the room is seated in it: the layer of the change centered, and every other layer against the one it was ordered by, each box as near as it can be to the middle of the boxes it is linked to. A layer longer than the room runs on from the left edge. Every layer slides under the window by the same amount, each no farther than its own end, so a layer that fits never moves and the links are drawn to wherever the boxes then stand.
- **`sheet`.** Every layer is seated across the longest one's width, each box by the boxes it is linked to, and the window moves over all of them alike.

The window moves by cells both ways. A box the window's edge cuts ends there in an ellipsis, and a link to a box out of view runs off the edge. The wheel scrolls along the map or down it, whichever way has more rooms' worth out of view.

The selected box has a double frame. The links that touch it, and the boxes of every file linked to it, are painted `accent`: that is the only sign of a link between two files of one layer, or of layers that are not neighbors, since links are drawn between neighboring layers only.

A room narrower than `GRAPH_COLUMNS` or shorter than `GRAPH_ROWS` has no graph: `modeIn` answers the tree for it.

## The Tree

`treeOf` gives one row a file. Each changed file heads a tree: the files that use it hang under it, each under the first file one step nearer the change that it uses, and after them the files it uses. A file linked to nothing is a root of its own, after the changed ones.

A row is the file's mark and path, the folder dim, and then the names of its symbols in a column. A row longer than the room ends in an ellipsis. The window moves by rows.

## The List

`drawList` draws the selected file's symbols, a row each: its mark, its name, its line, and what to know of it, which is how a changed symbol changed, the risk of a flagged one, and `untested`. The selected symbol's name is marked.

The list has a fixed number of rows. With more symbols than rows, the line over it says which it shows, as `symbols 3–5 of 9`, and the first and last rows are marked where there are more above and below. It scrolls as the map does: no farther than shows the selected symbol, and by the wheel without moving the selection.

## The Selection

The selection is a symbol's id, and the selected file is the one that holds it. Selecting a file selects its first symbol, or the one already selected when the file was.

`selectedOf` answers the symbol the view names while the map still holds it; otherwise a reader starts on the first symbol that breaks, then the first that needs review, then the first changed one.

| Key | In the graph | In the tree |
| :- | :- | :- |
| `h`, left | The file to the left in the layer. | The file this row hangs under. |
| `l`, right | The file to the right in the layer. | The first file that hangs under this row. |
| `k`, up | The layer above: the nearest file in the window that uses this one, else the nearest. | The row above. |
| `j`, down | The layer below: the nearest file in the window that this one uses, else the nearest. | The row below. |
| `u`, `d` | The symbol above and below in the list. | The same. |
| `n` | The next flagged symbol, and after the last the first again. | The same. |

A new map starts the selection over.

The keys that start something are digits: `1` asks Claude about the selected symbol, `2` maps the same scope and focus again, and `3` writes the web page. A prompt typed while the pane has the keyboard cannot set one off with its first letter.

## The Pane

The `ui.render` hook in `ripple/hooks/register.tsx` draws the pane. In a terminal it holds, top to bottom: the header, which changes the map is of and how they were traced, the mapper's summary, a notice while a mapper is at work or once the changes have moved on, the legend, the map, the selected file's path over the list of its symbols, what the selected symbol is and the mapper's reason for it, and the keys.

`planOf` shares the pane's rows out. It counts the summary as it wraps and the legend and the keys as they flow across the pane's width. The list gets as many rows as the map's fullest file has symbols, up to a limit, and the rows under it are fixed, so nothing in the pane moves as the selection does. A pane with fewer than `ROOMY_ROWS` rows keeps only the header, the notice, the map, a shorter list, one row for the reason, and the keys.

The map and the list are each drawn by a surface module, `ripple/hooks/pane.tsx`, because only a surface module is handed pointer events and the arrow keys. It paints the drawing it is given and posts what the person did: the hit a click landed on, and each key pressed while it holds the keyboard. The hooks module keeps the view in the session state `ripple.view`: the mode, the selected symbol, and where the person scrolled the map and the list to, which is null while they follow the selection. It decides what a click or a key does. In the list, the up and down arrows go through the symbols.

The wheel reaches the hooks module as `ui.scroll`, with the row of the pane it was over. A turn over the map scrolls the map, and one over the list or below it scrolls the list. When the pane is too short for all it draws, the turn is left to the engine, which scrolls the pane.

The keys are Buttons the hooks module draws under the list, which work whenever the pane has the keyboard; the arrow keys reach the map or the list only after a click on it. A press is answered by a `ui.press` hook and not by the Button's own closure, which the engine runs beneath the mod's hooks: a mapper started from there would not be the mod's to guard. The pane asks for the keyboard when the person opens it, and not when a map arrives.

The `view` option in the plugin's manifest picks the view a map opens in, and the `t` key switches for the rest of the session. The `scroll` option picks how the graph scrolls.

## The Rings

`ringSvg` draws the map as an SVG, a symbol a dot: the changed symbols at the center, their dependencies on a dashed inner ring, direct dependents on the next ring, and farther ones on the outer ring, each beside the dependent it uses. It is what the desktop app, the VS Code extension, and the mobile app show in the pane, over two buttons that map again and write the web page: those surfaces have no selection and no list. It is also what `graphHtml` puts on the page `/ripple web` writes, over a key to every mark.
