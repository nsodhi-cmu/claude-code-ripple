# The Map

A map is what the mapper reported and which changes it is of. Its types are in `ripple/types/index.d.ts`, and reading and describing it is `ripple/hooks/map.ts`.

## Nodes And Edges

A node is one symbol.

| Field | What it holds |
| :- | :- |
| `id` | Unique within the map: `<file>:<name>`. |
| `name` | The symbol as the code writes it. |
| `kind` | What the language calls it, lowercase: `function`, `struct`, `trait`, `const`. |
| `file`, `line` | Where a changed symbol or a dependency is defined, and where a dependent first uses what changed. |
| `role` | `changed`: the diff touches it. `dependent`: it uses a changed symbol, directly or through other dependents. `dependency`: a changed symbol uses it. |
| `depth` | Steps from the nearest changed symbol; 0 for a changed one. |
| `change` | On a changed symbol: `signature`, `behavior`, `renamed`, `added`, or `removed`. |
| `risk` | On a dependent: `breaks`, `review`, or `ok`. Every other node is `ok`. |
| `isTested` | Whether any test file references it. |
| `reason` | One line: why a dependent is flagged, or what changed about a changed symbol. |

An edge `{ from, to }` says that `from` uses `to`: calls it, constructs it, implements it, or reads it.

A map also holds the `method` the mapper relied on (`lsp`, `tooling`, or `grep`), its `summary`, and the scope, base, focus, and print of the changes it was made from.

## Reading A Report

`readReport` is lenient on purpose. A model's report is repaired where it can be, each repair is noted, and the notes go back to the mapper in the tool's answer. Only a report with no readable nodes is an error.

- A node needs a `name` and a `file`. One without them, or with an `id` already taken, is dropped.
- A node with no `role` is `changed` when it carries a `change`, and a `dependent` otherwise.
- `risk` is kept on dependents only, and `change` on changed symbols only.
- An edge that names no node, or joins a node to itself, is dropped.
- A reason or a summary too long to draw is cut, and ends in an ellipsis.
- `nodes` and `edges` sent as JSON text are read as the arrays they spell.

### Depth And Direction

The mapper does not report depth. `settle` works it out from the edges, outward from the changed symbols: first along the edges as reported, then, for nodes that leaves unreached, along edges read in either direction. A node no edge reaches sits one step out.

Then every edge is turned to run from the user to the used. Nodes have a rank along the flow of use: dependents are negative, by depth; changed symbols are 0; dependencies are positive. An edge that runs from a higher rank to a lower one is reversed. So a report with swapped edges still draws right.

### The Cap

A map holds at most `MAX_NODES` nodes. Past that the changed symbols are kept first, then what breaks, then what needs review, then the rest by depth, and the edges of what was cut go with it.

## What The Person Reads

`headerText`, `originText`, and `statusText` write the pane's first two lines and the status line under the prompt. The status line speaks only while a mapper is at work or while the map on hand has something flagged.
