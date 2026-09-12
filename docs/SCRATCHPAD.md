# Scratchpad: RU-3, RU-6, RU-7

Working notes for a session with Ethan, 2026-09-12. Three open things from the rubric
layer, staged with their context so we can work through them without re-reading the
branch. Nothing here is a decision; the decisions land in `testing/rubrics/DRAFTS.md`,
`testing/CASES.md`, and the code.

State: branch `rubric-layer`, 4 commits, pushed. `bun run check` green (typecheck, guard,
335 tests). RU-1, RU-2, RU-4, RU-5, RU-5.1 and RU-3 pass as judged; RU-6 fails; RU-7 has
a sweep but no rubric.

---

## RU-3 — zero-priming fluency

**Claim (doc):** an agent given only the binary name and a goal reaches a working graph.
**Scored pass^k, k=3.**

**Where it stands.** `bun run eval:zero-priming` runs three independent trials over
houseplants — a domain no `--help` example uses. 3/3 gates pass, $0.23. The judge was
then run over one trial's artifact and returned `pass`. The reference pair
(`zero-priming` / `ru-3-asked-the-user`) calibrates correctly.

**Open 3.1 — pass^3 grades the gates, not the rubric.**
The three trials are three *gate* runs. The judge ran once, over one artifact. So the
thing scored pass^3 today is "a graph exists with both plants and both are reported",
which is a mechanical check; the rubric's actual claim — arrived *by reading the
program's own output*, not by guesswork that happened to land — was judged on a single
trial. The doc says pass^k over the case, and the case is the rubric.

*My read:* this is a real gap and cheap to close. The judges are ~$0.04 each, so judging
all three trials is about $0.12 a run. The eval already keeps each trial's artifact
directory. Options:

- **(a) Judge every trial, require 3/3.** Truest to the doc. Adds ~$0.08 and one loop.
- **(b) Judge one trial, keep the gates at 3.** Status quo — defensible only if we say
  out loud that pass^3 is a gate-level score, which I don't think the doc supports.
- **(c) Judge every trial, require 2/3 with the third not `fail`.** Softer; I'd rather
  not, since RU-3 is *the* reliability case and softening its scoring is the one thing
  it cannot afford.

I'd take (a). It also gives us three judged samples per run, which is the only way we'd
ever notice the judge itself being flaky on this rubric.

**Open 3.2 — the dropped read-back gate, for the record.**
The first attempt scored 1/3 because I required a `query` call on turn 2. Two agents
added both plants and answered the User correctly from `add-item`'s own output. I removed
the gate, and the reason is recorded in `eval_zero_priming.ts` beside where it was.

The judgement call I made: RU-3's claim is that the agent *arrives*, not which command it
arrives by. Worth your confirmation, because there's a coherent opposite view — that
answering from the tool's own echo rather than reading the graph back is the agent
trusting its own memory of a write, which is exactly what a persistent store exists to
avoid. If you hold that view, the right home for it is a **new case about read-back**,
not a tightening of RU-3, since RU-3 would then be grading two claims at once.

---

## RU-6 — one ingestion to confirm, then bulk

**Claim (doc):** given unstructured source material, the Assistant does one ingestion to
confirm its understanding, then bulk-ingests the rest.

**Where it stands.** The scenario (`bun run eval:ingestion`) passes every gate: all twelve
books present, all carrying attributes, a shared attribute across all of them, the bulk
path used, and a correct five-star read-back. **The rubric fails the live run.**

**The judge's verdict, verbatim** (`testing/artifacts/judge-ingestion-2026-09-11T22-24-49Z-…/judgments.json`):

> The assistant went directly from receiving the raw list to writing all 12 fully-parsed
> items into books.yml and running `cog-graphs import` for the entire batch in one motion,
> with zero intermediate confirmation. The only confirmation offered was *after* the fact —
> showing the query result post-ingestion — which does not satisfy the guard, since by that
> point all 12 books, including any misread ones, were already committed to the graph.

It also named the interpretive calls the agent made unchecked: `Le Guin` → `Ursula K. Le
Guin`, `Weir` → `Andy Weir`, deciding which free text became a `note` and which was
dropped, and normalising the rating format. That is the doc's own argument for the flow —
"a bulk ingestion of a misread source multiplies the misreading" — happening live.

**Open 6.1 — what does the implementation owe?**
The rubric is doing its job, and nothing in the eval layer should move. The question is
what changes in the engine. Candidates, roughly ascending in weight:

- **(a) The primer teaches the flow.** `INTERFACE_SKILL_PRIMER` and/or `import --help`
  says, in one line, that the intended shape is confirm-a-sample-then-scale. Cheapest;
  it treats the flow as guidance an agent reads, which is what the primer is for. The
  risk is that it's advice, and an agent under a token budget skips advice.
- **(b) `import` acquires a confirmation affordance.** Something like `--dry-run`, which
  parses the source and reports what it *would* store without storing it — the agent then
  has a cheap way to show the User a reading. This makes the flow a capability rather than
  a suggestion. **New capability ⇒ your call, and probably a doc change.**
- **(c) `import` refuses a large batch into an empty graph** unless something was added
  first, or a flag says go ahead. I don't like this: it's the program legislating taste,
  and it breaks the legitimate case of an agent importing a source it has already checked
  in a previous turn.

*My read:* (a) as the immediate fix, and (b) as a proposal worth its own slice — the
`--dry-run` shape is genuinely useful beyond RU-6 (it's the natural answer to "what will
this do?" for any source file), and it's the only option that gives the agent a cheap way
to do the right thing rather than just telling it to. (c) I'd drop.

Whichever way it goes, RU-6 stays failing until it lands, and that is the correct state
for it to be in.

**Open 6.2 — a note on the first failed run, already handled.**
Asked to put the list "somewhere I can actually search", the first agent judged the
sandbox a temporary workspace and built the graph under `~/cog-graphs/books-read`. The
scenario now says "right here in this folder". Where a graph belongs is DE-7's subject,
not RU-6's, and there is a comment in `eval_ingestion.ts` saying so. Flagging only in case
you think the agent's instinct there deserves a case of its own.

---

## RU-7 — `next_step` is worth reading

**Claim (doc):** the `next_step` carried by an error is actionable — it names a command or
a concrete next move, not a restatement of the failure. (IN-11 asserts the field is
present and non-empty; RU-7 asserts it is worth reading.)

**Where it stands.** The sweep is landed and green. `testing/harness/error-sweep.ts`
provokes **20 codes**, each entry carrying exactly what an Operator meeting the error
would have: the invocation, the whole stderr, and that command's `--help`.
`testing/tests/error-sweep.test.ts` derives the expected code set from
`engine/main.ts`'s own source, so a code added to the engine cannot ship ungraded; a code
with no provocation must be *declared* unreachable with a reason, and today that is
`not_implemented` alone, established by asking the CLI rather than by a literal (DE-19.3).

**The rubric is deliberately not landed.** `rubrics.ts` ends with a comment saying why.

**Open 7.1 — what is a reference pair when the material is not a conversation?**

Every rubric in `rubrics.ts` is calibrated against a pair of hand-written *conversations*,
one plainly meeting the claim and one plainly breaking it, and `references.test.ts`
enforces the pair for free. RU-7's material is one error standing alone. A pair for it
would be two errors: one with a `next_step` worth reading, one without.

The concrete shapes:

- **(i) A second reference shape beside `Reference`.** Something like
  `ErrorReference { id, command, error, help }`, with its own labels, and
  `references.test.ts` extended to accept either shape for a rubric's pair. The sweep
  already produces exactly this material, so the failing half is the only thing that needs
  writing by hand — a plausible bad `next_step` for a real error.
- **(ii) Dress the error as a one-turn conversation.** Reuse `Reference` unchanged: a User
  turn ("why did that fail?"), a `run` step that provokes the error, an assistant `say`.
  No new machinery, but the judge is then reading a conversation, and RU-7's claim is
  about the error's text — we'd be inviting it to grade the assistant's paraphrase.
- **(iii) Calibrate RU-7 some other way** — e.g. hold out a few sweep entries hand-labelled
  by you, with no `Reference` involved at all.

*My read:* **(i)**. It keeps the material honest (the judge reads what the engine actually
emits), it keeps the pair rule intact rather than carving an exception in it, and the
sweep is already the generator. (ii) is cheaper but it changes what is being judged, which
is the one cost I don't want to pay on a rubric whose whole point is the text of an error.
(iii) weakens the discipline that the free test exists to enforce.

I stopped rather than build (i) unilaterally because the pair rule is what keeps a judge
honest, and changing its shape is a design call.

**Open 7.2 — how does RU-7 score?**
"The case passes when every error in the sweep does" (DRAFTS). That is 20 judge calls per
run, ~$0.04 each ≈ $0.80. Affordable, but worth deciding deliberately: one call per error,
or one call shown several errors at once? Separate calls are cleaner (a verdict per code,
and a bad `next_step` can't hide in a batch) and I'd default to them, but it makes RU-7
the most expensive case in the suite by an order of magnitude.

**Open 7.3 — a look at the material, for calibration.**
Reading the 20 `next_step`s myself, they are mostly strong — they name a command with the
Operator's own values substituted in:

- `entity_exists` → `Use modify item instead: cog-graphs modify-item --graph notes --entity 'First item' --attr key=value`
- `graph_not_found` → `This directory holds: notes. Use one of those, or create 'no-such-graph' with cog-graphs initialize --profile <file.yml>.`
- `partial_ingestion` → `Read 'rejected' — each entry names the offending entity and its zero-based index in the source's items list. Fix those records, then re-run import on a .yml holding only them.`

The ones I'd expect a judge to think hardest about:

- `missing_option` → `Run 'cog-graphs initialize --help' for a runnable example.` Actionable,
  but it's a redirect rather than an answer; it doesn't say *which* option is missing in the
  next_step itself (the `message` field does).
- `profile_unparseable` / `source_unparseable` → `Fix the YAML and run initialize again.
  Quoting every value is the safe default.` "Fix the YAML" is close to a restatement of the
  failure; the quoting hint is what rescues it.

If RU-7 fails on one of those, that's the case earning its place. I'd rather find out than
pre-emptively soften either the rubric or the strings.

---

## Suggested order for the session

1. **7.1** — settle the reference-pair shape. It unblocks the whole of RU-7, and it's the
   only one of the three that is purely a design call.
2. **6.1** — decide what the engine owes for RU-6. (b) needs a doc change if you want it,
   so it's worth deciding early.
3. **3.1** — judge all three zero-priming trials. Small, and I can land it straight away
   if you agree with (a).
