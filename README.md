# Ripple

**See what your changes reach.** Ripple is a Claude Code mod. Run `/ripple` and it maps everything that depends on the functions your uncommitted changes touch, draws the map inside Claude Code, and hands Claude the callers that may be broken, so it checks them before it says "done."

![Ripple mapping an edit and turning fixed callers green](docs/demo.gif)

Coding agents edit fast, and an edit's reach is invisible: change one function's signature and callers in other files break silently. Call-graph tools for agents exist, but they run outside Claude Code, Claude has to remember to call them, and they draw in a browser. Ripple lives inside the session:

- **It maps the diff, whoever made it.** Ripple reads `git diff`, so a change counts however it was made: Claude's edit, a `sed` Claude ran in the shell, your own typing, another session. The status line says `ripple: uncommitted changes in 3 files · /ripple to map`.
- **It maps in any language.** Ripple asks Claude to trace the impact with the tools the repository already has, so there is nothing to configure per language.
- **It draws the map natively.** A tree in the terminal, concentric rings in the desktop app.
- **It closes the loop.** The callers that need review go back to Claude, and each one turns green as Claude fixes it.

## Install

Ripple needs Claude Code 2.1.287 or later. At the prompt of a terminal session:

```
/plugin install ripple --marketplace nsodhi-cmu/claude-code-ripple
```

Answer `y` to add the marketplace, then pick a scope. The same in two steps:

```
/plugin marketplace add nsodhi-cmu/claude-code-ripple
/plugin install ripple@claude-code-ripple
```

## Use

Change something (or ask Claude to), then run `/ripple`.

| Command | What it does |
| :- | :- |
| `/ripple` | Shows the map of your uncommitted changes. If this diff is not mapped yet, it asks Claude to map it first. |
| `/ripple demo` | Shows a canned map. No model call, works offline. |
| `/ripple web` | Writes `.ripple/graph.html` (the ring view) and opens it in a browser. |
| `/ripple reset` | Clears the map. |

`/ripple` is the only command you need. Run it again on the same diff and the map comes straight back, with no model call; run it after the diff has changed and Claude maps the new one.

The pane opens docked beside the transcript in a wide terminal, and above the prompt in a narrow one:

```
Ripple · 1 change → 6 callers · 3 need review · via LSP
◉ formatPrice         src/price.ts:1           signature changed
├─ ● renderCart       src/cart.ts:14           NEEDS REVIEW · untested · passes 1 argument
│  └─ ○ CheckoutPage  src/pages/checkout.ts:5
├─ ✓ renderInvoice    src/invoice.ts:11        updated
├─ ○ priceLabel       src/ui.ts:4
└─ ● emailReceipt     src/email.ts:6           NEEDS REVIEW · passes 1 argument
   calls → toFixed2, currencySymbol

1: Check renderCart  2: Check emailReceipt  r: Re-map  w: Open in browser
```

- **Amber** is what changed, **red** needs review, **green** was updated since the map, and plain is fine.
- **Check** asks Claude about that one caller. **Re-map** has Claude map the same diff again.
- Give the pane the keyboard (click it, or `ctrl+x tab`) and the digits and letters press the buttons.

In the desktop app's Code tab the same map is drawn as rings: the changed function at the center, what it calls on a dashed inner ring, its callers on the next ring and their callers on the outer one. Edges into a caller that needs review are red, and untested functions have a dashed outline.

## How mapping works

Ripple reads the working tree's uncommitted changes with `git diff HEAD`, plus the files git does not track yet. It does not watch Claude's tools. `/ripple` sends Claude one prompt that lists those changes and asks for every function they touched, their callers to depth 2 and their callees to depth 1, found with the most precise tool the repository offers:

1. **The language server.** Claude's `LSP` tool: `prepareCallHierarchy`, then `incomingCalls` and `outgoingCalls`.
2. **The language's own checker.** `tsc --noEmit`, `cargo check`, `go vet`, `pyright` and the like. After a signature change, its errors point straight at the broken callers.
3. **Text search.** A search for the name, filtered by hand.

Claude then calls Ripple's one tool, `mcp__ripple__report`, with the map. The header says which of the three it relied on (`via LSP`, `via type checker`, `via text search`), which is how far to trust the map. A map holds at most 40 functions.

The tool's answer lists the callers that need review and tells Claude to open, check and fix each one. After each turn Ripple reads the diff again: a new change in the same file that names a flagged caller, or lands within 15 lines of it, turns that caller green. Nothing is mapped again for that.

Mapping costs one model turn, so it runs when you ask for it and never by itself.

## Sentry MCP: which callers are already failing in production

Ripple ships Sentry's MCP server (`ripple/.mcp.json`), so installing the mod connects it. Sign in once with `/mcp`.

When Sentry is connected, the mapping run adds one step: Claude searches Sentry for unresolved issues whose stack traces touch the changed function or its callers. Each function Sentry knows about comes back on the map with its issue count and top issue ID:

```
├─ ● renderCart  src/cart.ts:14  NEEDS REVIEW · untested · Sentry: 2 issues · SHOP-1A · passes 1 argument
```

- A caller with live issues is flagged needs-review even if the type checker is happy, and it is listed to Claude as "already failing in production", so it gets checked first.
- In the ring view it carries a purple halo; the tooltip has the issue's title.
- With no Sentry connection the step is skipped and the map is the same as before.

`/ripple demo` shows this with canned Sentry data (`SHOP-1A`, `SHOP-2F`), so it can be seen without a Sentry account.

## Try it

The repository has two tiny projects with the same shape: one price formatter, four callers, two pages on top, and one caller with no test.

```
cd examples/ts-shop        # or examples/rust-shop
claude --plugin-dir ../../ripple
```

Then ask: `Add a currency parameter to formatPrice. Only edit src/price.ts.` (in the Rust project, `format_price` and `src/price.rs`), or make that edit yourself, and run `/ripple`.

For the most precise maps, install a language server plugin for the language (for example `vtsls` or `rust-analyzer` from the `boostvolt/claude-code-lsps` marketplace) and put the server on your `PATH`. Without one, Ripple still works: Claude falls back to the type checker, then to text search.

## Develop

```
claude --plugin-dir ./ripple          # loads the mod from disk and reloads it on save
claude plugin validate --strict ./ripple
claude plugin test ./ripple
```

```
.claude-plugin/marketplace.json   makes this repository a marketplace
ripple/
  .claude-plugin/plugin.json      the manifest
  hooks/register.tsx              the hooks: reading git, /ripple, the report tool, the pane
  hooks/model.ts                  the map: reading a diff and a report, the prompts, which change touches which caller
  hooks/render.ts                 the tree view and the SVG ring view
  hooks/demo.ts                   the canned map
  hooks/*.test.ts                 unit tests, and the whole loop driven through the engine
  types/index.d.ts                the map's types and the mod's session state
examples/ts-shop, examples/rust-shop
```

The first time Claude Code loads the mod from this folder it writes its own API types into `ripple/.claude-plugin/types/`, which is what `ripple/tsconfig.json` and your editor read.

## Security

A mod is code that runs inside Claude Code, unsandboxed, with your permissions: it can do what you can do. Install one only if you trust its source, and read it first. Ripple's is four small files in `ripple/hooks/`.

What Ripple does with that access:

- **Reads** your uncommitted changes, by running `git diff HEAD` and `git ls-files --others` (both read-only) at session start, after each turn and on `/ripple`. It also sees each prompt's text as a turn starts, only to recognise its own mapping prompt, and keeps none of it.
- **Stores** the last map per project in the mod's own store, under your Claude Code configuration directory.
- **Writes** one file, `.ripple/graph.html`, and only when you run `/ripple web`.
- **Runs** one more command, your system's file opener (`open`, `xdg-open`, or `rundll32` on Windows), and only for `/ripple web`.
- **Sends prompts** to Claude when you run `/ripple` or press a button. It makes no network requests of its own.

## Limits

- Ripple maps everything uncommitted, not only the latest change: git cannot say which command made which change. Commit or stash the rest to map one change alone.
- It needs git: outside a repository, or with everything committed, there is no diff to map.
- A caller Claude checked and found correct stays red, since nothing was edited. Re-map to refresh it.
- The map is as good as the tool behind it. Calls through dynamic dispatch, reflection or strings can be missed, most of all when the map is `via text search`.
- One repository at a time.

## License

[Apache-2.0](LICENSE)
