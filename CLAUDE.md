# Cog Graphs

A system that lets an AI agent spawn and manipulate persistent knowledge graphs on demand — structure an agent can build on indefinitely.

v0.3 of a lineage: Corpus of Creative Endeavors (v0.1) → Durable Epistack KB Engine (v0.2) → Cog Graphs (v0.3). Currently in the **design phase of v0.3.1**, a walking-skeleton MVI. No code yet.

## The design doc is the source of truth, and it is not in this repo

The spec lives in Logseq — graph `Logseq-DB-Aurelius`, page `Cog Graphs`.

```bash
logseq show --graph "Logseq-DB-Aurelius" --page "Cog Graphs" --linked-references false
```

Read it before proposing anything architectural. Notes:

- `--graph` is required on every `logseq` command; omitting it fails with `Error (missing-repo)`.
- Block ids (the leading numbers) are stable within a session — use them to answer specific blocks precisely.
- Don't write to the graph unless asked. Ethan maintains it himself and prefers answers in conversation.

## Roles

Ethan is the designer, architect, and project manager. Claude is the engineer. He sets direction and holds the bar; implementation is Claude's to propose, justify, and own.

He wants genuine opinions and pushback — a recommendation with reasoning attached, and plain disagreement where it exists, not a survey of options. Naming a tension in his design and arguing a side is the useful contribution; he'll take it from there.

## Settled architecture

The design doc wins if any of this conflicts with it.

- **Interpretive instantiation.** One engine ships once; creating a graph writes *data* (profile + store), never generated code. No per-instance binaries or CLI names.
- **One graph per file**, identity carried by the filename. Authoritative `.sqlite`, plus a derived readable face the engine writes and never reads.
- **v0.3.1 stack:** TypeScript engine, inference via the Agent SDK (inherits the user's Claude Code auth), graph search only — no vector search this version.

## Hard constraints

- **Tests and evals are a second layer of the spec.** Never edit a test case, rubric, or eval to match an implementation. Raise it with Ethan; approved exceptions are recorded and timestamped.
- Consequential values and assumptions in code are centrally configurable and self-documented.
- Data is explicit, portable, inspectable, long-lived. Behavior is modular and replaceable.
- The CLI's audience is AI agents. Self-documenting, structured JSON out, errors that name next steps.
