# The Command

`/ripple` is the one command, registered at session start and served by the `command.run` hook in `ripple/hooks/register.tsx`. What it was asked is read by `readRequest` in `ripple/hooks/changes.ts`.

| Typed | Read as |
| :- | :- |
| `/ripple` | Map the uncommitted changes. |
| `/ripple branch` | Map the branch. |
| `/ripple web` | Write and open the web page. |
| `/ripple reset` | Clear the map, the mapper being waited on, and the stored map, and close the pane. |
| anything else | A focus. `branch` first picks the branch scope and the rest is the focus; otherwise every word is the focus, on the uncommitted changes. |

`web` and `reset` are verbs only when they stand alone, so `/ripple reset password flow` is a focus.

## Scopes

A scope is which changes are mapped. Each is one diff of the working tree against a base, read with `git diff <base> --relative --unified=0`, plus the files git does not track yet, read with `git ls-files --others --exclude-standard`.

- **uncommitted**: the base is `HEAD`.
- **branch**: the base is the commit this branch left the default branch at, `git merge-base HEAD <default>`. The default branch is the first of these that exists: what `origin/HEAD` points at, `main`, `master`. With none of them, `/ripple branch` says so and maps nothing.

`readChanges` turns the diff into one entry per file: its path, whether it was modified, added, deleted, or renamed, and how many hunks touch it. Paths under `.ripple/`, which `/ripple web` writes, are never changes.

## When A Mapper Is Started

Every reading of the changes has a print: a short hash of the scope, the diff, and the untracked listing. A map remembers the print and the focus it was made for.

`/ripple` reads the changes and then:

- with no changes, says so and stops;
- when the map on hand has this print and this focus, opens the pane on it, with no model call;
- when a mapper is already at work, opens the pane, which says so;
- otherwise starts a [mapper](MAPPER.md) and opens the pane.

The `2` key starts a mapper even when the map is current.

After each of the person's own turns, while a map is on hand, the changes of its scope are read again. When their print is no longer the map's, the pane says the changes have moved on.

## Between Sessions

The last map of a project is kept in the mod's store under `map:<project root>` and read back at session start. `/ripple reset` deletes it.

## The Web Page

`/ripple web` writes the map on hand to `.ripple/graph.html` under the project root and opens it with the system's opener. The page is the ring picture from `ripple/hooks/web.ts` with a key under it; the [views](VIEWS.md#the-rings) describe it.
