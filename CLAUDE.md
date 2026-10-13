@AGENTS.md

# Ripple

Ripple is a Claude Code mod: a plugin whose hooks are TypeScript that Claude Code loads and runs itself. `/ripple` reads the changes from git, starts a background agent that traces what depends on them and edits nothing, and draws that agent's report in a pane as a graph the person can move through.

## Commands

```
claude plugin validate --strict ./ripple    # what the engine would refuse to load
claude plugin validate --strict .           # the marketplace manifest
claude plugin test ./ripple                 # every test, with no session and no model
claude --plugin-dir ./ripple                # a session with the mod loaded from disk
```

There is no build and nothing to install. To type-check, load the mod once so that Claude Code writes its API types into `ripple/.claude-plugin/types/`, then point TypeScript at `ripple/tsconfig.json`.

## Where Things Are

```
.claude-plugin/marketplace.json   the marketplace that lists the plugin
ripple/.claude-plugin/plugin.json the manifest, and the one setting
ripple/hooks/
  register.tsx    every hook, and everything that touches the engine
  changes.ts      what /ripple was asked, and the changes as git reports them
  mapper.ts       the mapper's prompts, and what asking Claude about a node submits
  map.ts          reading a report into a map, and describing it
  files.ts        the map by file
  graph.ts        the graph view
  tree.ts         the tree view
  view.ts         the selection, the keys, and how the pane's rows are shared out
  draw.ts         what both views draw with
  pane.tsx        the surface module that paints a drawing and posts clicks and keys
  web.ts          the ring picture and the web page
ripple/tests/     the tests, one file for each of those it tests
ripple/types/     the map's types and the session state
docs/             one file for each part: the command, the mapper, the map, the views
```

## What The Engine Expects

The engine reads a hooks module's source before it loads it, and refuses what it cannot follow.

- A function that is handed `$` is declared at the top level of `register.tsx`, not inside `register`.
- An event matcher, a `$.state` reference, an environment variable's name, and a `Client`'s `module` path are literals in the source.
- A `Client` is the only element that receives pointer events and arrow keys, and it receives keys only after a click on it. A Button's `hotkey` works whenever the pane has the keyboard, but only on a Button the hooks module drew, not one inside a `Client`.
- In the test kit, a plugin's `$.agent.spawn` reaches the test's `agent.spawn` hook as the Agent tool's call, and the kit reads the started agent's id off `result.agentId`.
- The engine decides which shell commands run without a permission prompt by how they are spelled: `git diff --relative HEAD` does, and `git diff HEAD --relative` does not. A mapper is refused what would prompt, so a command its prompt names has to be one the engine lets through: `git show <ref>:./<path>` is another that is. `$.tool.check({ tool: 'Bash', input: { command } })` answers for any spelling, with nothing run.

The API's types are the reference for everything else: `ripple/.claude-plugin/types/claude-code/index.d.ts`, once the mod has been loaded.

## Trying A Change

The tests cover what the mod does with a report, not what a mapper makes of real code. To see that, make a change in some other git repository, run `claude --plugin-dir <path to this repository>/ripple` there, and run `/ripple`.
