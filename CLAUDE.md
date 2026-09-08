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

## The build loop (v0.3.1)

State lives in the repo, not in the conversation. To pick up cold: `git log --oneline`
shows the cases already green, `bun test` shows they still are, and the doc's Testing &
Evaluation section lists every case there is. Nothing else needs to be remembered.

**One slice at a time, vertically.** A slice is one case, start to finish:

1. Pick the next case from the doc, in Walking Skeleton order.
2. Write that one case as a test. Run it. **Watch it fail** — a case that has never been
   red has not been shown to test anything.
3. Write the least engine code that makes it pass, without breaking a green case.
4. `bun run guard && bun test`, then commit, naming the case:
   `DE-11: reject add-item on an existing entity`.

Do not write the next case's test before finishing this slice. Writing the suite ahead
of the engine pins imagined behavior: shapes get frozen for commands nobody has written,
and the cases go quietly insensitive to what the system actually does.

- **A green case is frozen.** `testing/tests/*.test.ts`, `testing/tests/contract.ts` and
  `testing/evals/*.ts` are append-only — add cases freely, never edit a landed one.
  `bun run guard` enforces this by rejecting removed lines; it is not a formality, it is
  the only thing keeping the second layer of the spec honest. If a green case looks
  wrong, append to `testing/DISPUTES.md`, leave it alone, and carry on. Ethan resolves
  disputes; an open dispute blocks closure.
- `helpers.ts` and everything under `testing/harness/` are **not** frozen. They are
  mechanism, not spec — add a helper or a runtime feature when a slice needs one.
- The engine goes at `engine/main.ts` (override with `COG_CLI_ENTRY`). Until that file
  exists every CLI test fails with an explicit "expected RED" message — the correct
  day-one state, not a broken suite.
- **Cheap layer constantly, paid layer deliberately.** `bun test` is free and instant.
  Every `eval:*` script spends real money and minutes on a live agent; run one when its
  deterministic dependencies are green, never to check progress.
- **Do not enable SQLite WAL.** It leaves `-wal`/`-shm` files beside the database and
  breaks IN-6. One short-lived process per command needs no concurrency. Revisit only
  when concurrent Operators become real — and revisit IN-6 with it, not instead of it.
- Treat `--help` output as a deliverable. DE-2 and DE-5 grade it, and RU-3 asserts an
  agent with no primer reaches a working graph from it alone.

Closure, per the doc's Roadmap: all v0.3.1 cases taken red → green in good faith and
passing; the Walking Skeleton passing through the eval harness. The conclusive milestone
is Ethan's own manual pass — not yours to declare.
