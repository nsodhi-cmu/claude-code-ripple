# The Command

`/ripple` is the one command, registered at session start and served by the `command.run` hook in `ripple/hooks/register.tsx`, the hooks module that `ripple/hooks/hooks.json` names. What it was asked is read by `readRequest` in `ripple/hooks/changes.ts`.

| Typed | Read as |
| :- | :- |
| `/ripple` | Map the uncommitted changes. |
| `/ripple branch` | Map the branch. |
| `/ripple web` | Write and open the web page. |
| `/ripple reset` | Clear the map, the mapper being waited on, and the stored map, and close the pane. |
| anything else | A focus. `branch` first picks the branch scope and the rest is the focus; otherwise every word is the focus, on the uncommitted changes. |

`web` and `reset` are verbs only when they stand alone, so `/ripple reset password flow` is a focus.

## Scopes

A scope is which changes are mapped. Each is one diff of the working tree against a base, read with `git diff <base> --relative --unified=0`, plus the files git does not track yet, read with `git ls-files --others --exclude-standard`. Both are run in the session's project root and cover what is under it. The diff is spelled with its prefixes and its other choices fixed, so that nothing in the person's git configuration changes its shape, and both commands leave out `.ripple/`, which `/ripple web` writes.

- **uncommitted**: the base is `HEAD`.
- **branch**: the base is the commit this branch left the default branch at, `git merge-base HEAD <default>`. The default branch is the first of these that exists: what `origin/HEAD` points at, `main`, `master`. With none of them, `/ripple branch` says so and maps nothing.

`readChanges` turns the diff into one entry per file: its path, whether it was modified, added, deleted, or renamed, and how many hunks touch it.

When git cannot show the diff, as in a repository with no commits yet, `/ripple` says so. It never takes a failed reading for no changes.

## When A Mapper Is Started

Every reading of the changes has a print: a short hash of the scope, the diff, the untracked listing, and what the untracked files hold, which `git hash-object` tells. A map remembers the print and the focus it was made for.

`/ripple` reads the changes and then:

- with no changes, says so and stops;
- when the map on hand has this print and this focus, opens the pane on it, with no model call;
- when a mapper is already at work on these changes and this focus, opens the pane, which says so; when it is at work on anything else, says that it is, and starts nothing;
- otherwise starts a [mapper](MAPPER.md) and opens the pane.

The `2` key maps the scope and focus of the map on hand again, as the changes now stand, even when the map is current.

While a map is on hand, the changes of its scope are read again at session start, when the map arrives, and after each of the person's own turns. When their print is no longer the map's, the pane says the changes have moved on, and the status line under the prompt no longer counts what the map flagged.

## Between Sessions

The last map of a project is kept in the mod's store under `map:<project root>` and read back at session start. `/ripple reset` deletes it.

## The Web Page

`/ripple web` writes the map on hand to `.ripple/graph.html` under the project root and opens it with the system's opener. The page is the ring picture from `ripple/hooks/web.ts` with a key under it; the [views](VIEWS.md#the-rings) describe it.
