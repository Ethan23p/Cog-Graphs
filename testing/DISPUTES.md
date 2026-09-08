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
- **Resolution**: <Ethan — add a DE case for selection filtering, or confirm the gap is
  intentional for the MVI.>
