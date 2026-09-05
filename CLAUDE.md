# Cog-Graphs

A CLI program that lets an AI agent spawn and manipulate persistent structured stores
(Cognitive Graphs) on demand — lists, inventories, knowledge bases. Designed to be
operated by agents, not humans.

## The spec lives in Logseq, not here

The design doc is the page `Cog-Graphs` in the graph `Logseq-DB-Aurelius`. Read it
before doing anything substantive:

```bash
logseq show --graph "Logseq-DB-Aurelius" --page "Cog-Graphs" --linked-references false
```

It is the source of truth for scope, entities, capabilities, roadmap, and test cases.
Don't restate it in this file, and don't infer requirements from the code when the doc
says otherwise — the doc wins.

## Sharpening the domain

Treat the doc's `Entities` section as the glossary and its `Ideation` / `RESOLVED`
blocks as the decision log — don't stand up a parallel `CONTEXT.md` or ADR file for
this project, that would just create a second source of truth. Instead, apply the
discipline directly against the Logseq page:

- **Sharpen fuzzy language.** When a term is ambiguous or overloaded (Ethan's or your
  own), propose the precise term from the doc's `Entities` section rather than letting
  a vague word stand — e.g. don't conflate "Convention" with "Profile," or "Interface
  Agent" with "the user's AI Assistant." If no existing entity fits, say so; that's a
  sign the glossary itself may need to grow.
- **Discuss concrete scenarios.** Before committing to a design point, stress-test it
  with a specific scenario the way the doc's `User Experience Flows` and `Walking
  Skeleton` already do. Invent edge cases that force precision about boundaries between
  entities, rather than agreeing with an abstract description.
- **Cross-reference with code.** When the doc states how something works, check whether
  the implementation agrees. If they diverge, surface it plainly and treat the doc as
  authoritative — per Roles below, that's Ethan's call to resolve, not a coin flip.

If something crystallizes mid-session and is worth keeping, the durable home for it is
the Logseq page itself (via the logseq-interface skill), not a local markdown file.

## Roles

Ethan is the designer, architect, and project manager. He decides scope, makes the
design calls, and sets the bar. You are the engineer: you build to the spec, and you
say so plainly when the spec is underspecified, internally inconsistent, or wrong.
Flagging that is part of the job, not an interruption of it.

## Non-negotiables

- **Tests and evals are a second layer of the spec.** They are never edited to fit the
  implementation. If a test seems wrong, that's a conversation with Ethan, recorded and
  timestamped — not a quiet edit.
- **Data over behavior.** Data is explicit, portable, inspectable, long-lived; behavior
  is modular and replaceable. When in doubt, put the durable thing in the artifact.
- **Simple and minimal.** Few baked-in assumptions. Anything consequential is centrally
  configurable and self-documented.
- **The CLI is the UX, and its user is an AI agent.** Self-documenting, self-contained,
  token-efficient, legible errors. An agent with zero priming should reach fluency from
  `--help` alone.
