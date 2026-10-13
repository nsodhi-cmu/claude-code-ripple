# Ripple

Ripple is a Claude Code mod that maps what a code change reaches. Run `/ripple` and a background agent traces what depends on the code you changed. The map is drawn inside Claude Code: what changed, what uses it, and which of those the change breaks.

```
Ripple · 1 change → 6 dependents · 2 break · 1 to review
uncommitted changes · via LSP
Two callers of formatPrice no longer compile, and receipts may show the wrong currency.
◆ changed  ● breaks  ▲ review  ○ ok  → uses

           ┌───────────────┐  ┌────────────────────┐
           │ ○ checkout.ts │  │ ○ pages/invoice.ts │
           └────────┬──────┘  └────────┬───────────┘
                    │                  │
                    ▼                  ▼
              ╔═══════════╗  ┌──────────────────┐  ┌─────────┐  ┌────────────┐
              ║ ● cart.ts ║  │ ● src/invoice.ts │  │ ○ ui.ts │  │ ▲ email.ts │
              ╚═════╤═════╝  └────────────────┬─┘  └────┬────┘  └──────┬─────┘
                    └─────────────────────────┼─────────┴──────────────┘
                                              ▼
                                       ┌────────────┐
                                       │ ◆ price.ts │
                                       └──────┬─────┘
                                              │
                                              ▼
                                      ┌───────────────┐
                                      │ → money.ts  2 │
                                      └───────────────┘

▸ src/cart.ts · 1 symbol · open
  ● renderCart  :14  breaks · untested
renderCart · function · uses formatPrice · used by CheckoutPage
passes 1 argument; formatPrice now takes 2

h: ←  j: ↓  k: ↑  l: →  u: symbol ↑  d: symbol ↓  n: next flagged  t: tree view
1: ask Claude  2: re-map  3: web page
```

A diff shows what you changed and nothing of what it reaches. Rename a struct, add a parameter, or loosen a check, and code in files you never opened breaks, or quietly starts doing something else. Ripple maps that code.

- **The diff is read from git**, so a change counts whether Claude made it, a script did, or you did.
- **The map is of symbols**: functions, types, fields, and constants. A Claude agent does the tracing with the tools the repository already has, so no language needs setting up.
- **The mapper works in the background**, apart from your conversation. It has no tool that edits files, and a command that would need your permission is refused, not put to you.
- **The map is drawn by file**: a box a file, and under the map the symbols it holds in the selected file, each with its line and why it is flagged.

## Installing

Ripple is tested on Claude Code 2.1.296. Mods are new and their API still changes between releases, so an older Claude Code may not load it. At the prompt of a session:

```
/plugin install ripple --marketplace nsodhi-cmu/claude-code-ripple
```

Answer `y` to add the marketplace, then pick a scope. The same in two steps:

```
/plugin marketplace add nsodhi-cmu/claude-code-ripple
/plugin install ripple@claude-code-ripple
```

## Using It

Change something, or ask Claude to, then run `/ripple`.

| Command | What it does |
| :- | :- |
| `/ripple` | Maps your uncommitted changes. |
| `/ripple branch` | Maps everything since this branch left the default one, uncommitted changes included. |
| `/ripple <focus>` | Maps only what bears on the focus: a symbol, as in `/ripple formatPrice`, or a question, as in `/ripple could this leak the session token?`. Works after `branch` too. |
| `/ripple web` | Writes the map to `.ripple/graph.html` as a ring picture and opens it in a browser. |
| `/ripple reset` | Clears the map. |

Mapping runs in the background, so you can keep working while it does. Run `/ripple` again on changes that are already mapped and the map comes straight back, with no model call.

### The Map

The pane opens beside the transcript where the terminal is wide enough for Claude Code to dock it, and above the prompt otherwise.

Each box is a file, marked as the worst of its symbols is, with a count when it holds more than one. The files that use the change sit above it, and the files it uses below. One file is selected: its box is double-framed, and its links and the files they reach are lit. Under the map is the list of that file's symbols, in the order they stand in the file, each with its line. One of them is selected too, and the lines under the list say what it is, what it is linked to, and the mapper's reason for flagging it.

| Key | What it does |
| :- | :- |
| `h` `j` `k` `l` | Move from file to file: left, down, up, and right. |
| `u` `d` | Move up and down the selected file's symbols. |
| `n` | Go to the next flagged symbol, in whatever file it is. |
| `t` | Switch between the graph and the tree. |
| `1` | Ask Claude, in the conversation, about the selected symbol. It is asked to explain and to edit nothing. |
| `2` | Map again: the same scope and focus, as the changes now stand. |
| `3` | The same as `/ripple web`. |

The keys work while the pane has the keyboard, which it asks for when you open it. `ctrl+x tab` moves the keyboard between the pane and the prompt, and typing anything else goes back to the prompt. The keys that start something are digits, so the first letter of a prompt never sets one off.

The mouse works without the keyboard. A click on a box selects its file, and a click on a row of the list selects that symbol. The wheel scrolls whichever of the two it is over. Once the map or the list has been clicked, the arrow keys move through it as the letters do.

#### A Map Larger Than The Pane

The files of a layer keep one order, whatever is selected. A layer longer than the pane runs off its edge, a box the edge cuts ends in an ellipsis, and a row under the map counts the files out of view on each side:

```
 ┌───────────────┐  ┌────────────────────┐
 │ ○ checkout.ts │  │ ○ pages/invoice.ts │
 └───────┬───────┘  └──────────┬─────────┘
─────────┘     ┌───────────────┘
               ▼
──┐  ┌──────────────────┐  ╔═════════╗  ┌───
… │  │ ● src/invoice.ts │  ║ ○ ui.ts ║  │ ▲…
──┘  └────────────────┬─┘  ╚════╤════╝  └───
──────────────────────┼─────────┴───────────
                      ▼
               ┌────────────┐
               │ ◆ price.ts │
               └──────┬─────┘
                      │
                      ▼
              ┌───────────────┐
              │ → money.ts  2 │
              └───────────────┘
← 1 more                            1 more →
```

The map scrolls when the selection moves out of view, and no farther than it takes to show the selected file and the start of the one past it. The wheel scrolls it without moving the selection, and so does a click on one of the counts. A layer that fits the pane stays where it is while a longer one slides, so the change stays in view as you go along the files that use it.

A list longer than its rows scrolls the same way: the line over it says which symbols it shows, and its first and last rows are marked where there are more above and below.

Where there is no room for a graph at all, the pane draws the tree, a row a file, with the symbols of each after its path:

```
◆ src/price.ts                 formatPrice
├─ ● src/cart.ts               renderCart
│  └─ ○ src/pages/checkout.ts  CheckoutPage
├─ ● src/invoice.ts            renderInvoice
│  └─ ○ src/pages/invoice.ts   InvoicePage
├─ ○ src/ui.ts                 priceLabel
├─ ▲ src/email.ts              emailReceipt
└─ → src/money.ts              currencySymbol, toFixed2
```

In the tree `j` and `k` go down and up the rows, `h` goes to the file a row hangs under, and `l` to the first that hangs under it.

To open on the tree every time, set **Default view** to `tree` in `/config`, or run `/plugin configure ripple@claude-code-ripple`.

The desktop app, the VS Code extension, and the mobile app draw the map as a still ring picture in place of the graph, with nothing to select: the two buttons under it map again and write the web page.

### What The Marks Mean

Ripple runs no tests and no analysis of its own. The mapper reads the code and judges it; Ripple draws that.

| Mark | What it means |
| :- | :- |
| `◆` **changed** | A symbol the changes touch: a function, a type, a field, a constant. |
| `●` **breaks** | A dependent that no longer compiles or runs as written, such as one that passes the old number of arguments. |
| `▲` **review** | A dependent that still runs but may now behave differently, or one the change leaves less protected: its reason then starts with `security:`. |
| `○` **ok** | A dependent the change does not affect. |
| `→` **uses** | A symbol a changed one uses. It is there for context and is not judged. |
| **untested** | No test file mentions the symbol by name. Nothing is run: it says a test may be missing, not that one fails. |

A file is marked for what it holds: `◆` when any symbol in it changed, and otherwise as the worst of its symbols is.

The line under the header says how far to trust a map: `via LSP` and `via type checker` come from the language's own tools, `via text search` from a search the mapper filtered by reading each hit.

## How Mapping Works

`/ripple` reads the changes from git and starts a mapper: a background Claude agent with three tools, `Read`, `Bash`, and `LSP`, and a fourth to report with. It is given the command that shows the diff, the files that changed, your focus if you gave one, and notes on the languages the change is written in. It names the symbols the diff touches, follows what depends on them outward, lists what they use, and judges each dependent. Its instructions stop it three steps out from the change among dependents, and one step among what the change uses. Then it reports once, and the report becomes the map.

The mapper looks for dependents with the most precise method the repository allows:

1. **The language server**, when the session has one for the language.
2. **The language's own checker**, such as `tsc --noEmit` or `cargo check`, when your permission rules already allow the command.
3. **Text search**, with every hit read and judged.

A mapper never raises a permission dialog. A command that would have asked is refused, and it falls back to the next method. To let it use a checker, allow that command in your permission rules, for example `Bash(cargo check:*)`.

Ripple has notes for TypeScript and JavaScript, Python, Rust, and Go: where dependents hide in each, which checker to run, and where the tests are. Any other language is mapped by the same method without them.

[docs/](docs/) describes each part: the [command](docs/COMMAND.md), the [mapper](docs/MAPPER.md), the [map](docs/MAP.md), and the [views](docs/VIEWS.md).

## Developing

```
claude --plugin-dir ./ripple                # load the mod from disk; it reloads on save
claude plugin validate --strict ./ripple    # what the engine would refuse, before a session finds out
claude plugin validate --strict .           # the marketplace manifest
claude plugin test ./ripple                 # the tests, with no session and no model
```

Each time Claude Code loads the mod from this folder it writes its own API types into `ripple/.claude-plugin/types/`. `ripple/tsconfig.json` includes them, so an editor or `tsc -p ripple` checks the mod against the engine it runs on.

## Security

A mod is code that runs inside Claude Code, unsandboxed, with your permissions. Install one only if you trust its source, and read it first: Ripple's is in `ripple/hooks/`.

What Ripple does with that access:

- **Reads git.** It runs read-only git commands (`diff`, `ls-files`, `hash-object`, `symbolic-ref`, `rev-parse`, `merge-base`) when you run `/ripple`, and at session start and after each of your turns while it holds a map, to tell when the changes have moved on.
- **Starts one agent per mapping**, in the background, which reads your code. It can call `Read`, `Bash`, `LSP`, and the report tool. It has no `Edit` or `Write` tool, its instructions forbid changing anything, and any call that would have asked for your permission is refused. A shell command that your session runs without asking, because of your permission rules or a mode such as `bypassPermissions`, is not refused: there the instructions are all that keep the mapper from writing.
- **Watches permission checks.** To refuse what a mapper would have asked for, a hook sees every permission check of the session. It changes the answer only for a mapper's, and only from "ask" to "deny".
- **Stores** the last map of each project in the mod's own store, under your Claude Code configuration directory.
- **Writes** one file, `.ripple/graph.html`, and only for `/ripple web`, which also runs your system's file opener (`open`, `xdg-open`, or `rundll32` on Windows).
- **Submits a prompt** to your conversation only when you press `1`. The prompt is marked as Ripple's, not as your own words, and quotes what the mapper wrote as the mapper's.

It makes no network requests of its own.

## Limits

- A map is a reading of the code, not a proof. Uses through dynamic dispatch, reflection, or strings can be missed, most of all when the map is `via text search`.
- A mapping is one agent run, which costs what any subagent costs. It runs only when you ask.
- A map holds at most 60 symbols. Past that the mapper keeps the changed symbols, then what breaks, then what needs review, then the nearest dependents.
- The graph draws the links between neighboring layers. Two files linked within a layer, or across more than one, are lit when either is selected, with no line drawn between them.
- A name is drawn one cell a character, so a name written in characters two cells wide pushes its row out of line.
- Ripple needs git and at least one commit, and maps one repository at a time.

## License

[Apache-2.0](LICENSE)
