---
name: cog-graphs
description: This skill should be used when a task would benefit from persistent, structured data that outlives the conversation — a list, a shortlist, an inventory, a tracker, a knowledge base, or memory the User wants to keep and point any assistant at later. Also applies when the User mentions a Cog Graph, a `.sqlite` with a derived `.md` beside it, or the `cog-graphs` CLI.
---

# Cog-Graphs

`cog-graphs` is on your PATH. It spawns and manipulates Cog Graphs: persistent stores of
entities and the attribute/value pairs recorded about them, kept as files in a directory the
User owns.

The CLI documents itself, and this skill deliberately repeats none of it.

## The primer

When this skill is invoked, a hook runs `cog-graphs introduce --interface-skill` and places its
primer above as context. Read it in full before touching a graph: it covers spawning one,
querying, adding and changing items, bulk import, and coming in cold.

If the primer is not above, the hook did not run. Run the command yourself.

## Working with it

- Every command answers `--help`. Check it the first time you meet a surface rather than
  assuming the grammar has held still.
- Establish the profile — a namespace and a description in the User's words — with the User
  conversationally before initializing. Keep graphs out of temp directories unless the graph
  is meant to be scratch.
- Coming back to an existing graph, start with `cog-graphs introduce --graph <namespace>`: it
  says what the graph is for and the convention it keeps.
- If `cog-graphs` does not resolve in your shell, the engine is also runnable directly:
  `bun "${CLAUDE_PLUGIN_ROOT}/main.ts" <command>`. It needs [Bun](https://bun.sh).
