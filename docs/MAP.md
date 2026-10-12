# The Map

A map is what the mapper reported and which changes it is of. Its types are in `ripple/types/index.d.ts`, and reading and describing it is `ripple/hooks/map.ts`.

## Nodes And Edges

A node is one symbol.

| Field | What it holds |
| :- | :- |
| `id` | Unique within the map. The mapper is asked for `<file>:<name>`, which is also what a node sent without one is given. |
| `name` | The symbol as the code writes it. |
| `kind` | What the language calls it, lowercase: `function`, `struct`, `trait`, `const`. |
| `file`, `line` | Where a changed symbol or a dependency is defined, and where a dependent first uses what changed. |
| `role` | `changed`: the diff touches it. `dependent`: it uses a changed symbol, directly or through other dependents. `dependency`: a changed symbol uses it. |
| `depth` | Steps from the nearest changed symbol; 0 for a changed one. |
| `change` | On a changed symbol: `signature`, `behavior`, `renamed`, `added`, or `removed`. |
| `risk` | `breaks`, `review`, or `ok`: on a dependent, and on a changed symbol that another change puts at risk. A dependency is always `ok`. |
| `isTested` | Whether any test file references it. |
| `reason` | One line: why a dependent is flagged, or what changed about a changed symbol. |

An edge `{ from, to }` says that `from` uses `to`: calls it, constructs it, implements it, or reads it.

A map also holds the `method` the mapper relied on (`lsp`, `tooling`, or `grep`), its `summary`, and the scope, base, focus, and print of the changes it was made from.

## Reading A Report

`readReport` is lenient. A model's report is repaired where it can be. Dropped nodes, dropped edges, and a cut made by the cap are noted, and the notes go back to the mapper in the tool's answer. A report whose nodes are not a list, or of which no node can be read, is an error; a report with no nodes at all is a map of a change that touches nothing.

- A node needs a `name` and a `file`. One without them, or with an `id` already taken, is dropped.
- A node with no `role` is `changed` when it carries a `change`, and a `dependent` otherwise.
- `risk` is dropped from a dependency, and `change` from anything but a changed symbol.
- Every string is made safe to draw: control characters and line breaks become spaces. A `role`, `risk`, `change`, or `method` is read in whatever case it was written.
- An edge that names no node, or joins a node to itself, is dropped.
- A reason or a summary too long to draw is cut, and ends in an ellipsis.
- `nodes` and `edges` sent as JSON text are read as the arrays they spell.

### Depth And Direction

The mapper does not report depth. `settle` works it out from the edges, outward from the changed symbols: first along the edges as reported, then, for nodes that leaves unreached, along edges read against their direction. A node no edge ties to a changed symbol sits one step out, and what hangs from it beyond it.

An edge stands as reported unless it was reported backward, which `settle` takes it to be in two cases: the edge had to be read against its direction to reach a node, or its roles cannot be a use, as when a changed symbol is said to use its own dependent. Those edges are turned to run from the user to the used, and the turning is noted. So a report with swapped edges still draws right, and a true use from a nearer dependent to a farther one is left alone.

### The Cap

A map holds at most `MAX_NODES` nodes. Past that the changed symbols are kept first, then what breaks, then what needs review, then the rest by depth, and the edges of what was cut go with it. What is left is then measured again, so a map reads back from the store exactly as it was drawn.

## What The Person Reads

`headerText`, `originText`, and `statusText` write the pane's first two lines and the status line under the prompt. The status line speaks only while a mapper is at work, or while the map on hand is still of the changes as they stand and has something flagged.
