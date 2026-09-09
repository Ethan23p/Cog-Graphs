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
- **Resolution**: <Ethan>

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
- **Resolution**: <Ethan>

## Resolved

_None._

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
