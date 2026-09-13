# Cog-Graphs

Spawn and manipulate **Cog Graphs** — persistent, structured stores of entities and the
attribute/value pairs recorded about them. An AI agent creates one on demand for a list, an
inventory, a tracker or a knowledge base, and it lives as two files in a directory the User
owns: `<namespace>.sqlite`, which holds everything, and a derived `<namespace>.md` beside it
for inspection.

The CLI's user is an AI agent. It documents itself: `cog-graphs --help` is the front door.

## Install

Requires [Bun](https://bun.sh) on PATH. The engine has no other dependencies.

In Claude Code:

```
/plugin marketplace add Ethan23p/Cog-Graphs
/plugin install cog-graphs@cog-graphs
```

## What the plugin adds

| Piece | Where | What it does |
|---|---|---|
| `cog-graphs` | `bin/` | The CLI, on the Bash tool's PATH while the plugin is enabled. `cog-graphs.cmd` covers cmd and PowerShell. |
| `cog-graphs` skill | `skills/cog-graphs/` | Tells the agent when a Cog Graph fits, and nothing the CLI already says. |
| Primer hook | `hooks/` | When the skill is invoked, loads `cog-graphs introduce --interface-skill` as context. Fails open. |

## Layout

This directory is both the engine and the plugin root. `main.ts` is the entry point; the
modules beside it are described at its top, and `IMPLEMENTATION.md` records the decisions they
embody. Tests, evals and the design record live in the repository around it and are not part
of the plugin.
