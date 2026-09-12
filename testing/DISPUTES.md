# Test disputes

Tests and evals are a second layer of the spec. They are never edited to fit the
implementation — that is a non-negotiable, and it is the only thing standing between
"the engine passes" and "the engine is correct."

Under the vertical loop a case is written and made green in the same slice, which makes
the rule sharper rather than looser: **once a case is green, it is frozen.** The moment
of danger is later, when a new slice makes an old case inconvenient. That is when the
temptation to "fix" the old case arrives, and that is the edit this file exists to
prevent.

So when a green case looks wrong, the move is **not** to fix it. It is:

1. Append an entry below, timestamped.
2. Leave the case as it is.
3. Carry on with the next slice.

Ethan resolves disputes. An open dispute blocks v0.3.1 closure, which is the point: a
case nobody can pass and nobody has argued with is a defect either way.

A dispute is worth raising when a case is **unsatisfiable, self-contradictory, ambiguous
enough that two correct engines would disagree, or asserts something the design doc does
not support**. It is not worth raising because a case is hard, or because passing it
would mean rewriting code you already wrote.

Raise one against `testing/tests/contract.ts` on the same terms. It is frozen too — and
because every test reads its surface from there, quietly widening it is the cheapest way
to make a suite lie.

## Entry format

```
### <CASE-ID> — <one-line claim>
- **Raised**: YYYY-MM-DD by <who>
- **The case says**: <quote or paraphrase>
- **The problem**: <why it cannot be satisfied, or what is ambiguous>
- **What I did instead**: <left as-is / partially satisfied — be specific>
- **Resolution**: <Ethan fills this in — amend the case, amend the doc, or reject the dispute>
```

## Open

_None._

## Resolved

### Walking Skeleton turn 5: "modifying a couple items" passes with nothing modified
- **Raised**: 2026-09-10 by Claude, while drafting the rubric layer.
- **The case says**: `testing/evals/eval_walking_skeleton.ts`, turn 5 (fresh thread). The
  User says *"I gave up on Hades for good, and I finally finished Portal 2 — can you update
  my games list to match?"* The gate asserts that the items' values match
  `/complete|finished|played|done/` and `/abandon|dropped|gave up|quit|shelved/`. The doc's
  step is "modifying a couple items".
- **The problem**: turn 3's user line (*"Portal 2, which I loved, and Hades, which I
  bounced off after a few runs"*) already lets an agent record `played` and `dropped`, and
  in the passing run of 2026-09-09T20-59 it did. At turn 5 the cold thread read the graph,
  concluded *"Nothing needed changing"*, and ran no `modify-item`: **0 of the run's 15
  tool calls**. The gate went green on turn 3's values. The case can pass without the step
  it exists to cover being exercised, so the Walking Skeleton's green says nothing about
  `modify-item` through a live agent.
- **What I did instead**: left it as is. The file is frozen and the fix lives in the
  scenario's user lines, which is the scenario's spec.
- **What I'd recommend**: make turn 3 leave room for a real change (e.g. *"Portal 2, which
  I'm about halfway through"*), and append a gate asserting that at least one item's
  values differ between the checkpoints either side of turn 5, so a no-op can never pass
  again. Separately, whether "finally finished" and "for good" should have been recorded
  as new information is a rubric question, raised as D8 in `testing/rubrics/DRAFTS.md`.
- **Resolution**: 2026-09-11, Ethan. **Not a defect.** The Walking Skeleton's user turns
  were written while implementation requirements were looser, and they are low-signal
  material. Tightening earlier work is a normal part of the process: "sometimes you'll
  need to tighten up implementation from earlier." I read that as blessing a rewrite of
  the scenario's user turns. The eval file is frozen, so the rewrite will land citing this
  resolution. **Landed 2026-09-11**, as recommended: turn 3 now reads *"Portal 2, which I'm
  about halfway through and loving"*, and a check appended below DE-24 fails the run unless
  Portal 2's values differ between the checkpoints either side of turn 5. Turn 3's user
  line is the one line of `eval_walking_skeleton.ts` that changed.

### IN-9/IN-10/IN-11 — the "unbuilt command" row named `import` in a literal
- **Raised**: 2026-09-09 by Claude, during DE-19.
- **Applied under the DE-19.3 precedent rather than held open** — see Resolution. Flagged
  here and in the commit so reversing it costs one commit.
- **The case said**: `invariants.test.ts`,
  `here("unbuilt command", ["import", "--graph", g.namespace, "--from", "./items.yml"])`,
  graded by IN-10 against `EXIT.INTERNAL` and by IN-9/IN-11 as a structured failure.
- **The problem**: the identical shape to DE-19.3, in a file the DE-19.3 dispute did not
  name because I had not found it yet. The moment `import` was built, that invocation
  stopped being an unbuilt command and became a missing *file* — `source_not_found`,
  `EXIT.NOT_FOUND`. IN-9 and IN-11 stayed green, because a missing file is still a
  structured failure; only IN-10's exit-code row went red. That asymmetry is worth
  noting: two of the three sweeps would have gone on passing while covering something
  other than what their label said, which is the failure mode a table-driven test is
  most prone to and least likely to announce.
- **What I did**: amended it the way Ethan resolved DE-19.3 — the command is asked of the
  CLI. `unbuiltInvocation()` walks COMMANDS, takes the first whose `--help` reports
  `status: "not_implemented"`, and returns one invocation for it, or none when the set is
  empty. It is invoked with **no options at all**, so nothing but the build status can
  produce the answer. Giving it plausible-looking flags is precisely what let the old row
  drift.
- **Probed**: emptied `UNBUILT` in the engine and re-ran. The suite dropped from 125 to
  121 tests in that file with 0 failures — so the row is live and derived rather than
  incidentally passing, and the sweeps stay honest when nothing is unbuilt instead of
  going red or going vacuous.
- **Resolution**: 2026-09-09, applied under Ethan's DE-19.3 resolution of the same day,
  which upheld exactly this claim ("the case's real claim survives; only its input moved
  from a literal to the CLI") and blessed DE-19, which cannot land while this row names
  `import`. Ethan confirms or reverses; I did not treat the precedent as covering
  anything beyond the identical defect in a second file.
  **Confirmed by Ethan, 2026-09-11.**

### DE-19.3 — the unbuilt-command sweep cannot empty itself, and blocks DE-19
- **Raised**: 2026-09-08 by Claude
- **The case says**: `testing/tests/entrypoint.test.ts`, `const unbuilt = ["import",
  "convention"];` — for each name, run the first example from its own `--help` and
  require exit non-zero with `code: "not_implemented"`.
- **The problem**: the case's own comment states its lifetime — *"as DE-19/20/21 land,
  each command graduates out of UNBUILT and this stops covering it. The sweep is written
  over the set rather than the names so it empties itself honestly."* It is not written
  over the set. It is written over a hardcoded literal, so it does the opposite of what
  it says: the moment `import` is implemented, `import --help`'s example succeeds and
  DE-19.3 goes red. I wrote that comment and that literal in the same slice, and the
  contradiction between them is mine.
- **Why it can't be worked around**: DE-19 (bulk ingestion) requires `import` to exist.
  There is no engine that satisfies both DE-19 and DE-19.3 as written — one requires the
  command to work, the other requires it to report that it does not. DE-21 will collide
  with `convention` in exactly the same way.
- **What I did instead**: left the case untouched, and did not implement `import`. The
  DE-19 cases are written and red; they are parked at
  `testing/tests/import.test.ts.pending` (that suffix is outside the suite's glob, so
  the gate stays honest) along with the `writeItemsYml` helper they need. Renaming that
  file back to `.test.ts` is the whole of the work to resume. I did not edit
  `entrypoint.test.ts`, because "never edited to fit the implementation" is the
  non-negotiable and this is the textbook shape of the edit it forbids — the old case
  became inconvenient exactly when a new slice arrived.
- **What I'd recommend**: amend DE-19.3 to derive its list from the CLI rather than from
  a literal — `introduce --interface-skill` (or each command's `--help`) already reports
  `status: "not_implemented"`, so the sweep can ask the engine which commands are unbuilt
  and assert the property over whatever comes back, including the empty set. That keeps
  the case's real claim ("an unbuilt command says so, distinguishably from a typo") and
  makes it retire itself as the comment always intended. Deleting the case outright would
  lose that claim while `convention` is still unbuilt.
- **Resolution**: 2026-09-09, Ethan — dispute upheld, recommendation blessed, and DE-19
  unblocked in the same breath. DE-19.3 now asks the engine which commands are unbuilt:
  it runs `<name> --help` for every command in COMMANDS and sweeps whatever comes back
  carrying `status: "not_implemented"`. The claim is unchanged; only its input moved
  from a literal to the CLI. A standing test asserts the derivation itself — every
  command's `--help` parses and reports a build status — so an empty sweep is a fact
  the suite established rather than a silent absence of tests. Landed in the same commit
  as this resolution, per the guard's own instruction.

### Stale reference — a frozen eval file names `DESIGN.md`, which no longer exists
- **Raised**: 2026-09-09 by Claude
- **Not a dispute about a case's claim** — it is a dispute about a comment inside a
  frozen file, and the freeze does not distinguish the two.
- **The situation**: `engine/DESIGN.md` and `testing/harness/DESIGN.md` were renamed to
  `IMPLEMENTATION.md`, and every reference was updated to be path-qualified, since the
  two files now share a basename. One reference lives in `testing/evals/eval_smoke.ts`:
  `// stats, sandbox isolation, and auth (DESIGN.md E5).` That file matches
  `testing/evals/*.ts` and is frozen, so `bun run guard` rejected the rewrite as a
  removed line.
- **What I did instead**: reverted that one file. The comment still says `DESIGN.md` and
  now points at nothing. Everywhere else says `testing/harness/IMPLEMENTATION.md`.
- **Why it is worth an entry rather than a shrug**: the freeze is doing exactly its job
  here — it cannot tell a prose comment from an assertion, and I would not want a guard
  that could, because "it was only a comment" is how the first quiet edit always
  introduces itself. The cost is one stale pointer.
- **What I'd recommend**: amend the comment to
  `(testing/harness/IMPLEMENTATION.md E5)` in the same commit as the resolution, so the
  history shows a frozen file changed by decision. Or leave it — E5 is still findable by
  its ID, which is the part that matters.
- **Resolution**: 2026-09-09, Ethan — edit blessed. `testing/evals/eval_smoke.ts:3` now
  reads `(testing/harness/IMPLEMENTATION.md E5)`. Landed in the same commit as this
  resolution.
### Coverage gap — query's `--attr` / `--exclude` filters have no v0.3.1 case
- **Raised**: 2026-09-08 by Claude
- **Not a dispute about a landed case** — recorded here because this is where
  second-layer problems go, and there is no better home for it yet.
- **The situation**: the doc ratifies the grammar line
  `cog-graphs query --graph <ns> [--attr k=v ...] [--exclude k=v ...]` (59547) and
  defines the semantics under Library > search strategies > selection (56424-56429).
  DE-5 therefore requires both flags to appear in `query --help`, and DE-4 requires
  them in the recognized-options list. But no v0.3.1 case exercises what they *do*.
- **What I did**: implemented selection filtering as the doc describes it — every
  `--attr` must match, no `--exclude` may — because help that names a flag which does
  nothing is worse than no flag. Marked the engine code with the same note.
- **Why it matters**: this is the doc's one search strategy for v0.3.1 and the thing
  that makes iterative traversal possible (56429). It is currently the largest piece of
  shipped behavior with nothing in the second layer pinning it.
- **Resolution**: 2026-09-08, Ethan — not a dispute, and not a second-pass item. A hole
  in the cases is the next vertical slice, and the engineer owns closing it: mint the
  case, take it red → green, report it at the end. Minted as **DE-10.1**. The rule is now
  in `CLAUDE.md` and minted cases are listed in `CASES.md`; future gaps go straight there
  rather than here. This file returns to what it is for — a landed case that looks
  *wrong*, which is still Ethan's to resolve.
### RU-6 withdrawn — the behavior it grades is not ours to grade
- **Raised**: 2026-09-12 by Ethan, reviewing `docs/SCRATCHPAD.md`.
- **Not a dispute about a claim that was wrong** — RU-6 worked. It was landed with a
  reference pair the judge got right, its scenario passed every gate, and on the live run
  the judge failed the agent with a rationale that named exactly what the doc's flow is
  written against. It is being withdrawn because the *subject* is not one Ethan wants
  graded, which is a scope call and therefore his.
- **The ruling** (Ethan, 2026-09-12): "We're not really interested in evaluating
  *implicit* behavior. I might even remove RU-6; but the solution would be to include
  instruction which tells the agent to be careful with bulk import, to ensure they
  understand... I think I'd rather remove it, I'm not interested in evaluating this
  behavior."
- **Why this needed an entry rather than a commit**: the doc's own non-negotiable is that
  "Tests-cases, rubrics, and such are never edited to meet the implementation; exceptions
  must be explicitly covered with Ethan, clearly recorded, and timestamped." Removing RU-6
  takes lines out of three frozen files — `testing/rubrics/rubrics.ts`,
  `testing/rubrics/references.ts`, and the whole of `testing/evals/eval_ingestion.ts` — so
  `bun run guard` rejects it by design. This is the exception, recorded and timestamped.
  Note what the ruling is *not*: it is not "the implementation failed RU-6, so RU-6 goes."
  The implementation did fail it. The reason it goes is that the behavior was never
  something the program should be graded on, and a rubric that grades an agent's taste
  rather than the program's guidance is measuring the wrong system.
- **What changed**: the RU-6 rubric, both its reference conversations and their two labels,
  and the ingestion scenario. `eval:ingestion` is gone from `package.json`. A comment at the
  removal site in each frozen file points here and at f1803a8, where all of it still lives.
  The run artifacts are kept, as every run's are.
- **Still open, and Ethan's**: the design doc is the authority for scope, and RU-6 is still
  block 60258 on `Cog-Graphs: Test Inventory, Walking Skeleton`. Until that block is struck,
  the doc and the repo disagree, and the doc wins. Proposed replacement text is in
  `docs/SCRATCHPAD.md`.
- **Resolution**: 2026-09-12, Ethan — removal blessed, landed in the same commit as this
  entry. The doc edit is outstanding.
