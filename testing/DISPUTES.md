# Test disputes

Tests and evals are a second layer of the spec. They are never edited to fit the
implementation — that is a non-negotiable, and it is the only thing standing between
"the engine passes" and "the engine is correct."

So when a case looks wrong, the move is **not** to fix the case. It is:

1. Append an entry below, timestamped.
2. Leave the case red.
3. Carry on with the next red case.

Ethan resolves disputes. An open dispute blocks v0.3.1 closure, which is the point: a
case nobody can pass and nobody has argued with is a defect either way.

A dispute is worth raising when a case is **unsatisfiable, self-contradictory,
ambiguous enough that two correct engines would disagree, or asserts something the
design doc does not support**. It is not worth raising because a case is hard, or
because passing it would mean rewriting code you already wrote.

## Entry format

```
### <CASE-ID> — <one-line claim>
- **Raised**: YYYY-MM-DD by <who>
- **The case says**: <quote or paraphrase>
- **The problem**: <why it cannot be satisfied, or what is ambiguous>
- **What I did instead**: <left red / partially satisfied — be specific>
- **Resolution**: <Ethan fills this in — amend the case, amend the doc, or reject the dispute>
```

## Open

_None._

## Resolved

_None._
