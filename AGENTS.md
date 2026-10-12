# Repository Structure

## Documentation Structure

- All documentation belongs inside `docs/`. The only exceptions are the root `README.md`, this `AGENTS.md`, and `CLAUDE.md`.
- Each part of the mod has one file in `docs/`, named for the part.
- To get oriented, start from `README.md`, which covers the whole mod, then `docs/`.
- Every markdown file is a factual description of the repository as it is, written so that a newcomer can read it and relate it directly to the code. If a sentence would not be true of the code as it stands, it does not belong.
- Update a part's doc in the same change that alters the code it describes.
- Do not write counts, ranges, or limits into documentation unless the code enforces them. A number that is merely what happens to be true today reads as a rule to the next reader.

## Code Structure

- The repository is a plugin marketplace with one plugin in it. `.claude-plugin/marketplace.json` lists the plugin, and `ripple/` is the plugin.
- `ripple/hooks/register.tsx` is the only file that touches the engine. Every other file in `ripple/hooks/` is pure: data in, data out, with nothing awaited.
- `ripple/hooks/pane.tsx` is the pane's surface module. It paints what it is handed and posts what the person did; it decides nothing.
- `ripple/types/index.d.ts` is the mod's contract: the map's types and the session state. It imports nothing.
- Tests live in `ripple/tests/`, one file for each file of `ripple/hooks/` it tests, beside a shared `fixture.ts`.
- `ripple/.claude-plugin/types/` is written by Claude Code and is never edited or committed.

# Style

## Comments

- Comments say what a thing is, not why it came to be; a rationale for a larger decision belongs in `docs/`.
- Comment sparingly: never restate the code, and almost never comment inside a function body.
- No comment or doc names a person, conversation, past attempt, issue number, or commit hash.

## TypeScript

- No dependencies. The mod is what Claude Code loads from the folder, with no build step and no `package.json`.
- A boolean is named for the question it answers: `isStale`, `hasNodes`.
- A constant that shapes behavior has a name and a comment that says what it bounds.
- Whatever a model sends is read leniently and repaired where it can be; whatever the mod sends a model is written out in `ripple/hooks/mapper.ts`, in one place.

## Tests

- Test names are sentences describing the claim: `a layer is ordered by what it is linked to in the layer nearer the change, so edges do not cross`, not `test layers 2`.
- Keep the set small and keep it hard. A test that is a tautology by the way the code is constructed should not exist; a test that would catch a subtle regression should.
- A drawing is tested as the whole picture it makes, compared line for line.
- The engine's side of the mod is tested through the engine's own test kit, as a person and a mapper would drive it: a command, a report, a key, a click.

## Logging

- The mod keeps no log of its own. A failure the person can act on is said to them; one they cannot goes to the engine's debug log.

# Prioritizations

- Write simple code that reads as a plain description of what it does: prefer the obvious approach over the clever one. Fewer lines is a soft priority.
- Prefer OS-agnostic code; where a platform split is unavoidable, isolate it in one function.
- Avoid options, flags, and knobs. The view the map opens in is the only setting.
- Prefer making illegal states unrepresentable over documenting that they are illegal.
- A mapping never edits code, never asks for permission, and never speaks in the conversation unless the person asks it to.

# Git

- Never put a session link, a conversation URL, or any other pointer back to the tool that wrote the code into a commit message or a pull request description.
- Every commit has a brief description in its body.
