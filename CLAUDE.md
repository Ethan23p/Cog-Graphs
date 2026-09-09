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
  timestamped — not a quiet edit. *Adding* a case to cover a hole is not that
  conversation; see "A hole in the cases is the next slice" below.
- **Data over behavior.** Data is explicit, portable, inspectable, long-lived; behavior
  is modular and replaceable. When in doubt, put the durable thing in the artifact.
- **Simple and minimal.** Few baked-in assumptions. Anything consequential is centrally
  configurable and self-documented.
- **The CLI is the UX, and its user is an AI agent.** Self-documenting, self-contained,
  token-efficient, legible errors. An agent with zero priming should reach fluency from
  `--help` alone.

## The build loop (v0.3.1)

State lives in the repo, not in the conversation. To pick up cold: `git log --oneline`
shows the cases already green, `bun test` shows they still are, and `testing/CASES.md`
lists every case there is, in slice order. Nothing else needs to be remembered.

`CASES.md` is a local extract for navigation; the doc is still the authority, and one
full ingestion at the start of a session is the intended way to hold it. If the two ever
disagree, the doc wins and the extract is stale.

`engine/IMPLEMENTATION.md` is the other half of that state: the decisions the engine
embodies, why each was taken, what was rejected, and the failure patterns that keep
recurring. Read it before changing engine behavior — most of what looks like tidying in
`main.ts` is load-bearing, and that file says which parts and why.
`testing/harness/IMPLEMENTATION.md` does the same for the eval runtime.

Both are held to one standard, and it is a hard rule rather than a style note: **every
claim carries a probe — a specific change to make, and the specific case expected to go
red.** A fresh instance with no memory of this project must be able to pick any entry,
run its probe, and learn in one command whether the entry earns its space. If the probe
is run and nothing goes red, the claim is not load-bearing and **the entry is deleted,
not softened** — a claim that survives by becoming unfalsifiable still costs a reader
their attention and no longer teaches them anything. That is how a long internal document
stays worth reading: it defends its own length the same way the suite does. Every
measured count carries the date it was measured; one without a date has not been checked.
A probe marked *reasoned* has not been run, and is labelled so it can be discounted
without guessing.

**One slice at a time, vertically.** A slice is one case, start to finish:

1. Pick the next case from `testing/CASES.md`, in slice order.
2. Write that one case as a test. Run it. **Watch it fail** — a case that has never been
   red has not been shown to test anything.
3. Write the least engine code that makes it pass, without breaking a green case.
4. `bun run check` — typecheck, guard, tests — then commit, naming the case:
   `DE-11: reject add-item on an existing entity`.

   Typecheck is in that gate for a reason, not for tidiness. `bun test` cannot see a
   whole class of defect that `tsc` catches instantly: a missing key on the exit-code
   map reads as `undefined`, `process.exit(undefined)` exits **0**, and the command
   prints a perfectly good error while telling the shell it succeeded. Every case that
   asserts an exit code goes green against that. Run the gate, not just the tests.

Do not write the next case's test before finishing this slice. Writing the suite ahead
of the engine pins imagined behavior: shapes get frozen for commands nobody has written,
and the cases go quietly insensitive to what the system actually does.

### A hole in the cases is the next slice

The doc's case list is not complete, and discovering that is normal rather than a
blocker. **When you find behavior that is shipped, or shipped-adjacent, with nothing in
the second layer pinning it, that hole is your next vertical slice.** Own it: mint the
case, take it red → green, carry on. You are the engineer; this is the job, not a
question to escalate.

Mint the ID by **where you were when you found it**, sub-numbered off the slice in
progress: a hole noticed while opening DE-19 becomes `DE-19.1`, `DE-19.2`, and so on.
That keeps the numbering honest about provenance — a minted case is dated by the loop,
not slotted into the doc's sequence as though Ethan had written it. Do the minted cases
before the slice they hang off, since they are usually prerequisites you tripped over on
the way in.

*Open question, raised by the loop and not yet ratified.* Provenance is not always the
most useful thing an ID can carry. A hole found while sweeping IN-9/10/11 that turns out
to extend DE-7's claim is `IN-9.1` under the rule above and `DE-7.1` under a
subject-based one, and only the second tells the next reader where to look. The cases
minted after the second `/code-review` pass use the subject-based form — DE-7.1,
DE-19.6.1, DE-19.7.1, DE-19.8.1, DE-19.8.2, IN-4.1 — each flagged in its own commit and
listed in `CASES.md`. Ethan decides which rule stands; renaming them later costs a commit.

A minted case is a case: it goes in `testing/tests/*.test.ts`, it is frozen once green,
and it is written to the same standard — a specific failure it rules out, in a comment,
in the case's own words. Add it to `testing/CASES.md` under **Minted** with one line on
what prompted it.

Two things stay Ethan's:

- **The doc is still the authority for scope.** A minted case pins behavior the doc
  already implies; it does not add capabilities. If closing a hole would require a new
  capability, that is a conversation, not a slice.
- **Every minted case gets reported.** Keep a running itemized list of the consequential
  calls — what you found, what you decided, what it cost — and hand it over at the end.
  Ethan ratifies them into the doc afterwards, or does not.

Sources of holes, in rough order of how often they pay out: a `/code-review` pass, a
capability the doc describes in prose but never grades, and a flag that `--help`
advertises while the engine ignores it.

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
