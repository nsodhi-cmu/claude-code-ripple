# The Mapper

The mapper is the background Claude agent that reads a change and reports its map. Its prompts and everything else Ripple says to a model are in `ripple/hooks/mapper.ts`; the hooks that run it are in `ripple/hooks/register.tsx`.

## The Agent

At session start Ripple registers an agent type, `ripple:mapper`, and a tool, `mcp__ripple__report`.

- The agent's system prompt is `MAPPER_PROMPT`. It replaces the session's own.
- Its tools are `Read`, `Bash`, `LSP`, and the report tool. It has nothing to edit files with.
- It always runs in the background.
- An `agent.offer` hook keeps it out of the model's list of agents: only `/ripple` starts one.
- The report tool is deferred, so its schema is not in the conversation's own prompt.

## Never Asking

A `tool.check` hook watches the mapper's calls. When the engine's verdict on one is `ask`, the hook answers `deny` in its place, with a line that tells the mapper to find another way. A read-only command, or one the person's permission rules allow, runs as it would for anyone. So the mapper never raises a permission dialog, and it can run a type checker exactly when the person has already allowed that command.

The hook applies to the one agent Ripple is waiting on and to no other.

## The Task

`taskPrompt` writes what one mapping asks:

- which changes, and the `git diff` command that shows them;
- each changed file and how it changed, the first sixty of them;
- the focus, when there is one, with the instruction to map only what bears on it;
- notes for the languages in the change.

The language notes are chosen by file extension. There are notes for TypeScript and JavaScript, Python, Rust, and Go. Each says where dependents hide in that language, which checker to run, and where its tests are. A change in another language gets no notes and the same method.

## The Method

The system prompt has four parts.

1. **Read the change.** List every symbol the diff touches and what changed about it: its signature, its behavior, or that it was renamed, added, or removed.
2. **Find what depends on it.** Follow dependents outward, and list what each changed symbol itself uses. Use the language server, then the language's checker, then text search, and say which was relied on.
3. **Judge every dependent** by its own code: `breaks`, `review`, or `ok`, with one line of reason for the first two. A reason that is a safety concern starts with `security:`.
4. **Report** once.

## The Report

The `tool.call` hook on `mcp__ripple__report` takes a report only from the agent Ripple is waiting on. Anyone else, the conversation's own model included, is refused.

A report is read by `readReport`, which the [map](MAP.md#reading-a-report) describes. One that cannot be read at all is refused with the reason, and the mapper may report again. One that can be read becomes the map: it is given the scope, base, focus, and print of the changes its mapper was started on, stored, and drawn. The tool's answer tells the mapper what was drawn and what Ripple had to repair.

A mapper whose turn ends with no report stops the wait, and the person is told. A mapper that died without a turn ending is noticed the next time `/ripple` runs, and replaced.

## Asking Claude

The `1` key submits `askPrompt` to the conversation. The conversation never saw the map, so the prompt carries what Ripple knows about the selected node: where it is, what changed, the mapper's verdict and reason. It asks for an explanation and for no edits.
