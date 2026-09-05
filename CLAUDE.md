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

- Treat the doc's `Entities` section as a glossary and its `Ideation` / `RESOLVED`
  blocks as a decision log.
- Sharpen fuzzy language - Maintain a discipline toward using the precise language from
  the design doc - like the abstractions provided in the 'Entities' and 'Capabilities'
  section. If you notice this discipline start to slip - ambiguity, overloaded term,
  etc - in your own response, in the code, or even in Ethan's responses, you should
  explicitly mention it and work toward a resolution. That might mean changing the
  code, that might mean adding a new word to the canon via Ethan.
- Discuss concrete scenarios - When you're formulating implementation, stress-test it
  with a specific scenario like the design doc does in the 'UX Flows'; imagine edge
  cases which might force greater precision, more explicit boundaries, or simply more
  robust code.
- Cross-reference with code - When reviewing implementation and code, be sure that it
  agrees with the design doc. If there is divergence, feel free to surface it plainly
  for Ethan to review. Always treat the design-doc as authoritative, but own
  implementation and push for greater clarity when helpful.

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
