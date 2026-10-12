# Ripple

**See what your changes reach.** Ripple is a Claude Code mod. Run `/ripple` and a read-only agent traces everything that depends on the code you changed. The map is drawn inside Claude Code: what changed, what uses it, and which of those the change breaks.

```
Ripple · 1 change → 6 dependents · 2 break · 1 to review
uncommitted changes · via LSP
Two callers of formatPrice no longer compile, and receipts may show the wrong currency.
◆ changed  ● breaks  ▲ review  ○ ok  → uses

   ┌────────────────┐  ┌───────────────┐
   │ ○ CheckoutPage │  │ ○ InvoicePage │
   └────────┬───────┘  └───────┬───────┘
            │                  │
            ▼                  ▼
    ╔══════════════╗  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐
    ║ ● renderCart ║  │ ● renderInvoice │  │ ○ priceLabel │  │ ▲ emailReceipt │
    ╚═══════╤══════╝  └────────┬────────┘  └───────┬──────┘  └────────┬───────┘
            └──────────────────┴─────────┬─────────┴──────────────────┘
                                         ▼
                                 ┌───────────────┐
                                 │ ◆ formatPrice │
                                 └───────┬───────┘
                                ┌────────┴─────────┐
                                ▼                  ▼
                         ┌────────────┐  ┌──────────────────┐
                         │ → toFixed2 │  │ → currencySymbol │
                         └────────────┘  └──────────────────┘

▸ renderCart · function · untested · src/cart.ts:14
breaks: passes 1 argument; formatPrice now takes 2
uses formatPrice · used by CheckoutPage

h: ←  j: ↓  k: ↑  l: →  n: next flagged  t: tree view  1: ask Claude  2: re-map  3: web page
```

A diff shows what you changed and nothing of what it reaches. Rename a struct, add a parameter, or loosen a check, and code in files you never opened breaks, or quietly starts doing something else. Ripple shows you that code before you ship.

- **It maps the diff, however it was made.** Ripple reads git, so a change counts whether Claude made it, a script did, or you did.
- **It maps symbols, in any language.** Functions, types, fields, and constants. A Claude agent does the tracing with the tools the repository already has, so there is nothing to set up per language.
- **It leaves your code and your conversation alone.** The mapper runs in the background with nothing to edit files with, and it is refused, not prompted, when a command would need your permission.
- **It is a map you move through.** Select a node to light its edges and read why it is flagged.

## Installing

Ripple is tested on Claude Code 2.1.296. Mods are new and their API still changes between releases, so an older Claude Code may not load it. At the prompt of a session:

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

The pane opens beside the transcript in a wide terminal and above the prompt in a narrow one. Dependents sit above the change and what the change uses sits below it. One node is selected: its box is double-framed, its edges are lit, and the lines under the map say what it is, where it is, why it is flagged, and what it is linked to.

| Key | What it does |
| :- | :- |
| `h` `j` `k` `l` | Move the selection left, down, up, and right. |
| `n` | Go to the next flagged node. |
| `t` | Switch between the graph and the tree. |
| `1` | Ask Claude, in the conversation, about the selected node. It is asked to explain and to edit nothing. |
| `2` | Map the same changes again. |
| `3` | The same as `/ripple web`. |

The keys work while the pane has the keyboard, which it asks for when you open it. `ctrl+x tab` moves the keyboard between the pane and the prompt, and typing anything else goes back to the prompt. The keys that start something are digits, so the first letter of a prompt never sets one off. A click on a box selects it, and once the map has been clicked the arrow keys move the selection too.

A layer too wide for the pane keeps the selected node, what it is linked to, and what is flagged, and folds the rest into a `+3 more` box. A map too tall keeps the layers around the selection. Where there is no room for a graph at all, the pane draws the tree:

```
◆ formatPrice         src/price.ts:1           signature changed
├─ ● renderCart       src/cart.ts:14           breaks · untested
│  └─ ○ CheckoutPage  src/pages/checkout.ts:5
├─ ● renderInvoice    src/invoice.ts:11        breaks
│  └─ ○ InvoicePage   src/pages/invoice.ts:5
├─ ○ priceLabel       src/ui.ts:4
├─ ▲ emailReceipt     src/email.ts:6           review
├─ → toFixed2         src/price.ts:9
└─ → currencySymbol   src/price.ts:13
```

To open on the tree every time, set **Default view** to `tree` in `/config`, or run `/plugin configure ripple@claude-code-ripple`.

The desktop app, the VS Code extension, and the mobile app draw the map as a still ring picture in place of the graph.

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

The line under the header says how far to trust a map: `via LSP` and `via type checker` come from the language's own tools, `via text search` from a search the mapper filtered by reading each hit.

## How Mapping Works

`/ripple` reads the changes from git and starts a mapper: a background Claude agent with three tools, `Read`, `Bash`, and `LSP`, and a fourth to report with. It is given the command that shows the diff, the files that changed, your focus if you gave one, and notes on the languages the change is written in. It names the symbols the diff touches, follows what depends on them outward, lists what they use, and judges each dependent. Then it reports once, and the report becomes the map.

The mapper looks for dependents with the most precise method the repository allows:

1. **The language server**, when the session has one for the language.
2. **The language's own checker**, such as `tsc --noEmit` or `cargo check`, when your permission rules already allow the command.
3. **Text search**, with every hit read and judged.

The mapper never raises a permission dialog. A command that would have asked is refused, and it falls back to the next method. To let it use a checker, allow that command in your permission rules, for example `Bash(cargo check:*)`.

Ripple has notes for TypeScript and JavaScript, Python, Rust, and Go: where dependents hide in each, which checker to run, and where the tests are. Any other language is mapped by the same method without them.

[docs/](docs/) describes each part: the [command](docs/COMMAND.md), the [mapper](docs/MAPPER.md), the [map](docs/MAP.md), and the [views](docs/VIEWS.md).

## Developing

```
claude --plugin-dir ./ripple                # load the mod from disk; it reloads on save
claude plugin validate --strict ./ripple    # what the engine would refuse, before a session finds out
claude plugin test ./ripple                 # the tests, with no session and no model
```

The first time Claude Code loads the mod from this folder it writes its own API types into `ripple/.claude-plugin/types/`. `ripple/tsconfig.json` includes them, so an editor or `tsc -p ripple` checks the mod against the engine it runs on.

## Security

A mod is code that runs inside Claude Code, unsandboxed, with your permissions. Install one only if you trust its source, and read it first: Ripple's is in `ripple/hooks/`.

What Ripple does with that access:

- **Reads git.** It runs read-only git commands (`diff`, `ls-files`, `symbolic-ref`, `rev-parse`, `merge-base`) when you run `/ripple`, and after each of your turns while it holds a map, to tell when the changes have moved on.
- **Starts one agent per mapping**, in the background, which reads your code. It can call `Read`, `Bash`, `LSP`, and the report tool, and any call that would have asked for your permission is refused.
- **Stores** the last map of each project in the mod's own store, under your Claude Code configuration directory.
- **Writes** one file, `.ripple/graph.html`, and only for `/ripple web`, which also runs your system's file opener (`open`, `xdg-open`, or `rundll32` on Windows).
- **Submits a prompt** to your conversation only when you press `1`.

It makes no network requests of its own.

## Limits

- A map is a reading of the code, not a proof. Uses through dynamic dispatch, reflection, or strings can be missed, most of all when the map is `via text search`.
- A mapping is one agent run, which costs what any subagent costs. It runs only when you ask.
- A map holds at most 60 symbols. Past that the mapper keeps the changed symbols, then what breaks, then what needs review, then the nearest dependents.
- The graph draws the edges between neighboring layers. Any other link of a node is in the lines under the map when the node is selected.
- Ripple needs git, and maps one repository at a time.

## License

[Apache-2.0](LICENSE)
