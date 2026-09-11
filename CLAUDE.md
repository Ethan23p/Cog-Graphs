# Cog-Graphs

A CLI program that lets an AI agent spawn and manipulate persistent structured stores
(Cognitive Graphs) on demand — lists, inventories, knowledge bases. Designed to be
operated by agents, not humans.

## The spec lives in Logseq, not here

The design doc is the page `Cog-Graphs` in the graph `Logseq-DB-Aurelius`. Read it before
doing anything substantive:

```bash
logseq show --graph "Logseq-DB-Aurelius" --page "Cog-Graphs" --linked-references false
```

It is the source of truth for scope, entities, capabilities, roadmap, and test cases.
Don't restate it here, and don't infer requirements from the code when the doc says
otherwise — the doc wins. One full ingestion at the start of a session is the intended way
to hold it; `testing/CASES.md` is a local extract for navigation, and if the two disagree
the extract is stale.

## Where everything is

| Path | What it is |
|---|---|
| `engine/main.ts` | The entire CLI. One file, no framework. Override the entrypoint under test with `COG_CLI_ENTRY`. |
| `engine/IMPLEMENTATION.md` | The decisions the engine embodies, why, and what was rejected. **Read before changing engine behavior.** |
| `testing/tests/*.test.ts` | The cheap layer. Frozen once green. |
| `testing/tests/helpers.ts` | Fixture builders. Not frozen. |
| `testing/evals/*.ts` | The paid layer — scenarios run against a live agent. Frozen once green. |
| `testing/harness/` | The eval runtime. Not frozen. `IMPLEMENTATION.md` there covers the SDK. |
| `testing/CASES.md` | Every case there is, in slice order, plus minted ones. |
| `testing/DISPUTES.md` | A landed case that looks *wrong*. Ethan resolves; an open dispute blocks closure. |

```bash
bun run check          # typecheck && guard && tests — the commit gate
bun test               # cheap layer only, ~seconds
bun run guard          # frozen-file check on its own
bun run verify:claims  # re-runs the free empirical claims in the IMPLEMENTATION files
bun run eval:smoke     # paid, ~$0.04 — the harness works end to end
bun run eval:skeleton  # paid, ~$0.40 — the Walking Skeleton through a live agent
```

The two facts everything else hangs off: **the `.sqlite` is authoritative, the `.md` is a
view of it, and nothing is ever taken back from the view.** And the exit alphabet:
`0 ok ; 1 usage ; 2 not found ; 3 already exists ; 4 partial ingestion ; 5 ambiguous ;
6 internal`. A new command picks from that list; it does not extend it.

## Roles

Ethan is the designer, architect, and project manager. He decides scope, makes the design
calls, and sets the bar. You are the engineer: you build to the spec, and you say so
plainly when the spec is underspecified, internally inconsistent, or wrong. Flagging that
is part of the job, not an interruption of it.

## Sharpening the domain

- Treat the doc's `Entities` section as a glossary and its `Ideation` / `RESOLVED` blocks
  as a decision log. Use that vocabulary in code, tests and prose.
- **When the discipline slips — an ambiguity, an overloaded term — say so and resolve it**,
  whether it slipped in your response, in the code, or in Ethan's. Resolution might be a
  code change, or a new word added to the canon via Ethan.
- Stress-test proposed behavior against a concrete scenario, the way the doc's `UX Flows`
  do. Edge cases are where the boundaries get drawn.
- Surface divergence between doc and code plainly. The doc is authoritative on scope; own
  the implementation and push for clarity where it helps.

## Non-negotiables

- **Tests and evals are a second layer of the spec.** They are never edited to fit the
  implementation. If a test seems wrong, that's a conversation with Ethan, recorded and
  timestamped — not a quiet edit. *Adding* a case to cover a hole is not that conversation;
  see below.
- **Data over behavior.** Data is explicit, portable, inspectable, long-lived; behavior is
  modular and replaceable. When in doubt, put the durable thing in the artifact.
- **Simple and minimal.** Few baked-in assumptions. Anything consequential is centrally
  configurable and self-documented.
- **The CLI is the UX, and its user is an AI agent.** Self-documenting, self-contained,
  token-efficient, legible errors. An agent with zero priming should reach fluency from
  `--help` alone — treat that output as a deliverable. DE-2 and DE-5 grade it; RU-3 asserts
  an agent reaches a working graph from it alone.
- **Do not enable SQLite WAL.** It leaves `-wal`/`-shm` files beside the database and breaks
  IN-6. One short-lived process per command needs no concurrency. Revisit only when
  concurrent Operators become real — and revisit IN-6 *with* it, not instead of it.

## The build loop

State lives in the repo, not in the conversation. To pick up cold: `git log --oneline`
shows the cases already green, `bun test` shows they still are, `testing/CASES.md` lists
every case there is in slice order, and the two `IMPLEMENTATION.md` files say why the code
looks the way it does. Nothing else needs to be remembered.

**One slice at a time, vertically.** A slice is one case, start to finish:

1. Pick the next case from `testing/CASES.md`, in slice order.
2. Write that one case as a test. Run it. **Watch it fail** — a case that has never been
   red has not been shown to test anything.
3. Write the least engine code that makes it pass, without breaking a green case.
4. `bun run check`, then commit naming the case: `DE-11: reject add-item on an existing
   entity`. Put the probe in the commit message.

   Typecheck is in that gate for a reason, not for tidiness. `bun test` cannot see a whole
   class of defect that `tsc` catches instantly: a missing key on the exit-code map reads
   as `undefined`, `process.exit(undefined)` exits **0**, and the command prints a perfectly
   good error while telling the shell it succeeded. Every case that asserts an exit code
   goes green against that. Run the gate, not just the tests.

Do not write the next case's test before finishing this slice. Writing the suite ahead of
the engine pins imagined behavior: shapes get frozen for commands nobody has written, and
the cases go quietly insensitive to what the system actually does.

**If a mechanism lands before its case** — it happens — the slice is not lost, but green is
no longer evidence. Recover it with an explicit probe: break the specific behavior, watch
the specific case go red, revert, and record both in the commit message. Two probes on
different parts of the mechanism is the usual price.

### A hole in the cases is the next slice

The doc's case list is not complete, and discovering that is normal rather than a blocker.
**When you find behavior that is shipped, or shipped-adjacent, with nothing in the second
layer pinning it, that hole is your next vertical slice.** Own it: mint the case, take it
red → green, carry on. You are the engineer; this is the job, not a question to escalate.

Number a minted case **by subject first**: sub-number it off the case whose claim it
extends, so the ID tells the next reader where to look. A hole found while sweeping
IN-9/10/11 that extends DE-7's claim is `DE-7.1`. Fall back to **the slice you were in
when you found it** only when no existing case is its subject (Ethan, 2026-09-11). The
DE-19.1–19.8 block predates the rule and keeps its provenance numbers: those IDs are cited
in commits, disputes and `IMPLEMENTATION.md`, and renumbering would break every one of
those pointers for the sake of tidiness.

Do the minted cases before the slice they hang off, since they are usually prerequisites
you tripped over on the way in.

A minted case is a case: it goes in `testing/tests/*.test.ts`, it is frozen once green, and
it is written to the same standard — a specific failure it rules out, in a comment, in the
case's own words. Add it to `testing/CASES.md` under **Minted** with one line on what
prompted it. Two things stay Ethan's: **the doc is still the authority for scope** (a minted
case pins behavior the doc already implies; if closing a hole needs a new capability, that
is a conversation), and **every minted case gets reported** — keep a running itemized list
of the consequential calls and hand it over at the end.

Sources of holes, in rough order of how often they pay out: a `/code-review` pass, a
capability the doc describes in prose but never grades, and a flag that `--help` advertises
while the engine ignores it.

### Frozen files

`testing/tests/*.test.ts`, `testing/tests/contract.ts` and `testing/evals/*.ts` are
append-only. Add cases freely; never edit a landed one. `bun run guard` enforces it by
rejecting removed lines — not a formality, it is the only thing keeping the second layer of
the spec honest. If a green case looks wrong, append to `testing/DISPUTES.md`, leave it
alone, and carry on.

The guard compares lines, so **any** rewritten line is a removal, including a line you wrote
an hour ago in the same file. In practice that means: to add to a frozen file, add *new*
lines only. Do not extend an existing `import` statement — write a second one. Do not reflow
a paragraph, retitle a `describe`, or fix a typo in a comment. The guard cannot tell a
comment from an assertion and should not have to.

`helpers.ts` and everything under `testing/harness/` are **not** frozen. They are mechanism,
not spec — add a helper or a runtime feature when a slice needs one.

### The two internal docs, and the standard they are held to

`engine/IMPLEMENTATION.md` and `testing/harness/IMPLEMENTATION.md` record the decisions the
code embodies, why each was taken, what was rejected, and the failure patterns that keep
recurring. Read the relevant one before changing behavior — most of what looks like tidying
is load-bearing, and those files say which parts and why.

Both are held to one hard rule: **every claim carries a probe — a specific change to make,
and the specific case expected to go red.** A fresh instance with no memory of this project
must be able to pick any entry, run its probe, and learn in one command whether the entry
earns its space. If the probe is run and nothing goes red, the claim is not load-bearing and
**the entry is deleted, not softened** — a claim that survives by becoming unfalsifiable
still costs a reader their attention and no longer teaches them anything. That is how a long
internal document defends its own length, the same way the suite does. Every measured count
carries the date it was measured. A probe marked *reasoned* has not been run and is labelled
so it can be discounted without guessing. Citations name a symbol, never a line number.

### The paid layer

`bun test` is free and instant; run it constantly. Every `eval:*` script spends real money
and minutes on a live agent. Run one when its deterministic dependencies are green, and
periodically thereafter for the data it gives — the cost is negligible against what a live
run turns up. The anti-pattern is a paid test inside a loop, or a paid run used to check
progress.

Three operational facts, each of which cost a run to learn:

- **`.env` holds `CLAUDE_CODE_OAUTH_TOKEN`, is gitignored, and must never be committed.** It
  does not follow a worktree — copy it in, and confirm with `git status --short --ignored`.
- **Never pipe an eval through `tail` or any pager.** The in-loop agent's orphaned
  subprocesses inherit stdout, so the pipe never sees EOF and a finished run looks hung.
  Redirect to a file, or read `testing/artifacts/<run>/summary.json`.
- **Sandboxes live in `~/cog-graph-workspaces/`** and are kept, not deleted — a failed run is
  only diagnosable from what it left behind, so that directory accumulates and is Ethan's to
  prune. The path is part of the scenario: an agent reads it and reasons about whether its
  User's data belongs there. See the harness doc for what that cost.

Closure, per the doc's Roadmap: all v0.3.1 cases taken red → green in good faith and
passing; the Walking Skeleton passing through the eval harness. The conclusive milestone is
Ethan's own manual pass — not yours to declare.
