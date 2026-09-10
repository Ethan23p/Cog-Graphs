# The rubric layer — drafts for review

**Status: draft, not landed.** Nothing here is frozen yet. Once a rubric lands in
`testing/evals/*.ts` it is frozen like any other case, so this file is the place to argue
with the wording — after that it costs a conversation.

Each RU case below carries five things, and the last two are the ones that make it a case
rather than a vibe:

1. **The claim**, quoted from the doc, unedited.
2. **Where it attaches** — which scenario and which turns.
3. **The projection** — exactly what the judge is shown, and never the case ID or its text.
4. **The verdict rule**, with an explicit disqualifier list and an explicit *non*-disqualifier
   list. The second list is what stops one rubric from punishing what another rewards.
5. **The calibration pair** — one hand-written transcript that must pass and one that must
   fail. A rubric that passes its own negative fixture is not measuring anything, and is
   deleted or rewritten rather than kept.

---

## Why the calibration pair, and what it is for

The free layer gets red-first: write the case, watch it fail, then build. The paid layer has
never had that, and a rubric is the part of the paid layer most able to fail silently — a
judge that says `pass` on everything looks exactly like an engine that works.

So a rubric's red is the **negative fixture**: a short hand-written transcript that embodies
the failure the rubric exists to catch. The rubric is not green until the negative fixture is
red. That is the same discipline as red-first, moved to the only place in an eval where it
can actually be applied, and it costs no agent time: the fixtures are static JSON and the
judge call is small.

Fixtures live in `testing/evals/fixtures/rubrics/<case>.{pass,fail}.json`, and
`bun run eval:rubric-calibration` runs all fourteen judge calls with no agent in the loop —
estimated well under $0.10 for the set. It is the RU layer's answer to JU-2 ("every automated
case has a reference solution"), and it runs on every rubric edit.

## Judge hygiene, applied to all seven

- **One judge call per case.** A single call returning seven verdicts is cheaper and lets one
  rubric's reasoning contaminate the next; a failure also stops localizing.
- **The judge sees a projection, not the whole transcript.** Two reasons, and only the
  first is about correctness of the verdict.

  For RU-2, RU-4 and RU-7 the wide view *defeats the claim*: each of those cases asks
  whether something can be established from a specific, limited amount of information, so
  handing the judge more than that amount answers a different question. RU-4 shown the tool
  calls grades whether the explanation was accurate rather than whether it was necessary;
  RU-7 shown the `code` and `message` reads a restatement as informative, because it now
  holds the context that makes the restatement feel like it says something; RU-2 shown turns
  1–4 cannot tell orientation from a lucky guess, since what the first thread named things is
  exactly what the cold thread does not know.

  For the rest it is about drift. The doc's own annotation on RU-4 warns that the rubric
  drifts run to run without an anchor, and a ~200KB JSON transcript is the drift surface: the
  judge finds different salient material on different runs and the verdict moves while the
  engine stands still. Narrowing the input is the same move as the closed term list, applied
  to the input instead of the criteria.

  **What the projection is *not* protecting against:** the transcript does not contain the
  gates' verdicts. `runScenario` keeps assertion labels in a separate `gates` array and hands
  `grade()` only the recorded SDK messages, so no case ID, assertion text or pass/fail ever
  reaches a judge (`runtime.ts`, `transcript.record` vs `gates.push`). The real version of
  that hazard is narrower and worth stating plainly: the transcript carries the *agent's own
  self-report* — prose claiming the work was done, and the CLI's own success output — which is
  the party under evaluation telling the judge it succeeded. That is the hazard the Walking
  Skeleton header already names ("grading prose is how an eval starts rewarding an agent that
  *says* it stored something"), and it argues specifically for RU-5's artifact-only
  projection, not for narrowing everywhere.

- **The cost of a projection, stated so it is not forgotten.** Projecting is deciding in
  advance what could possibly be relevant. Project wrongly and the judge cannot see evidence
  that would have changed its verdict, and the rubric fails *invisibly* — the report looks
  identical. The calibration pair only partly covers this: a negative fixture proves the
  rubric catches the failure that was anticipated, not that the projection preserved evidence
  for one that was not. Any rubric whose verdicts look stable but wrong should have its
  projection widened first, before its wording is touched.
- **Evidence is mandatory.** Verdict schema:
  `{ pass: boolean, evidence: string[], reasoning: string, observations: string[] }`.
  Each rubric ends with: *if you cannot cite a specific message or command as evidence, the
  verdict is `false`.* `observations` is a free field for anything notable that the rule does
  not make a failure — that is where product findings surface without corrupting the verdict.
- **Pinned model**, recorded per rubric. Start at `claude-sonnet-5`; move a rubric to Opus
  only if its calibration pair proves unstable there, and record the date and the reason.
- **pass@1 everywhere except RU-3**, per the doc.

The projection needs one harness addition (`testing/harness/` is mechanism, not spec, so this
is free to write): a `project()` helper that turns a `CapturedMessage[]` into any of —
user turns only, assistant prose only, tool calls with results, a single turn index, or a
named combination. Each rubric names its projection.

---

## RU-1 — the profile is established conversationally

> The Assistant establishes the profile configuration *conversationally* with the User rather
> than inventing it.

Doc grounding: *"For initialization, the operator sets the configuration; if a human is
directing their Assistant, the Assistant should conversationally establish the configuration
options with them."* (Scope 56393.)

**Attaches to:** Walking Skeleton, turns 1–2. Rides the existing run.

**Projection:** all user messages; all assistant prose from turns 1–2; the argv of the first
`cog-graphs initialize` call and the index of the message it appeared in; the contents of the
profile `.yml` the assistant wrote, if it wrote one. No other tool calls.

**Verdict — pass iff all three:**
- Before the first `initialize`, the assistant described in plain prose what would be created
  and what it would hold, and
- a User message *between* that description and the `initialize` call grants assent, and
- every profile field that carries subject matter — namespace, description, and the seeded
  convention — is traceable to something the User said or agreed to.

**Disqualifiers:**
- `initialize` ran with no User message between the proposal and the call. (A question the
  assistant answers itself is not a conversation.)
- A profile field names subject matter the User never raised. *Cite the field and the value.*
- The assistant asked the User to choose something the User has no basis to choose — a
  namespace string, a file path convention, an attribute vocabulary. That is inventing work
  for the User, not establishing configuration with them.

**Not disqualifiers:**
- One compressed question rather than an interview. Restraint is the point; RU-4 punishes the
  interview, and these two rubrics must not pull in opposite directions.
- The assistant choosing the attribute names itself — that is RU-5's subject.
- The assistant choosing the temp filename for the `.yml`.

**Calibration pair.**
*Must fail:* assistant replies "Great idea — I've set up a games list for you at `games.sqlite`"
in its first message, with `initialize` in the same turn.
*Must pass:* assistant proposes a spreadsheet the User will own, names what it would track,
asks whether that is right and where it should live; User says yes and picks the directory;
`initialize` follows.

**Note on overlap:** the WS turn-1 gate already asserts *nothing was created* before assent.
That is the deterministic half — restraint. RU-1 is the other half: was the configuration
established *with* the User, or merely delayed by a turn.

---

## RU-2 — the cold thread orients from the CWD and the tooling

> The cold thread orients itself and reaches the right items using only the CWD and the
> tooling.

**Attaches to:** Walking Skeleton, turn 5 (`freshThread: true`) only. Rides the existing run.

**Projection:** turn 5 in full — the user message, every tool call with its result, and the
assistant prose. Earlier turns are withheld deliberately: the judge must not know what the
first thread named things, because that is exactly what the fresh thread does not know.

**Verdict — pass iff all three:**
- The session established that a graph exists, and its namespace, from the environment — a
  directory listing, the `.md` sidecar, `cog-graphs introduce`, or a `query` — and not from
  the User's message, which names neither.
- It reached both items the User referred to.
- It did not ask the User where the data lives, what the graph is called, or whether one
  exists.

**Disqualifiers:**
- The first `cog-graphs` call that names a namespace precedes any command or read that could
  have revealed it. A lucky guess is not orientation. *Cite the call order.*
- Any question to the User about the location, name, or existence of the store.
- The turn ends without both items updated *and* without the assistant saying what it could
  not find.

**Not disqualifiers, but recorded in `observations`:**
- Reading the `.md` sidecar directly. That is what the inspectable face is for.
- Reading the `.sqlite` with a SQL client rather than through the CLI. Not a failure of
  orientation — but it *is* a finding about the CLI's legibility, and it should be visible in
  the report rather than swallowed by a `pass`.

**Calibration pair.**
*Must fail:* first command is `cog-graphs query --graph games` with no prior listing, then
"I've updated your games list."
*Must pass:* `ls`, then `cog-graphs introduce`, then `query`, then two `modify-item` calls
naming the entities as the listing spelled them.

---

## RU-3 — zero-priming fluency (pass^k, k=3)

> Zero-priming fluency: an agent given only the binary name and a goal — no skill, no primer —
> reaches a working graph. **Scored pass^k, k=3.**

Doc grounding: *"an AI Agent should be able to pick it up with zero priming and get to a
fluent level of control"* (55837), and the expectation that an agent probes with `--help`
first (56411) rather than being told the grammar.

**Attaches to:** its own scenario, `zero-priming`. Three independent runs; RU-3 passes only if
all three pass. The report states `k/3` either way.

One user turn, one goal, nothing else: *"I want to keep track of the books I've read and what
I thought of them. Start with these three: …"* System prompt says only that a program called
`cog-graphs` is installed. No skill, no `--interface-skill`, no grammar.

**Most of this case is deterministic and belongs in gates, not in the judge:**
- a graph exists, with both faces, in the working directory;
- all three books are present with attributes;
- a non-empty convention is in the artifact;
- every `cog-graphs` invocation after the agent's first two exited 0 — "fluent" means it
  stopped guessing, and the exit codes say when that happened.

**The judge's part is the one thing the gates cannot see:** did the agent get *lost*.
Projection: assistant prose plus the ordered list of `cog-graphs` invocations with exit codes.
Pass iff the agent never (a) repeated an identical failing invocation more than once, (b)
stated that it could not work out how to use the tool, or (c) abandoned the tool for a
hand-rolled alternative — a plain file, a SQL client, its own script.

**Disqualifiers:** any of (a)–(c), cited by invocation index.

**Not a disqualifier:** several `--help` calls. Probing is the intended behavior and the doc
says so explicitly; a run that reads `--help` four times and then works is a *pass* whose
`--help` cost belongs in `observations` and, if it recurs, in DE-24's ceilings.

**Calibration pair.**
*Must fail:* four consecutive identical `add-item` calls exiting 1, then "the CLI doesn't seem
to accept this format — I'll keep the list in a markdown file instead."
*Must pass:* `--help`, one malformed call exiting 1, `add-item --help`, then three clean calls.

**Cost:** three full scenario runs, ~$0.4 each. This is the most expensive case in the suite
and the only one whose claim is reliability.

---

## RU-4 — the Assistant does not over-explain the mechanics

> The Assistant does not over-explain the mechanics to the User.
> Anchored: the judge is shown the user turns and asked whether any assistant message would
> require the User to learn a system abstraction in order to follow it. Without an anchor this
> rubric drifts run to run.

**Attaches to:** Walking Skeleton, all turns. Rides the existing run.

**Projection — the strictest of the seven:** user messages and assistant prose only. No tool
calls, no tool results, no file contents, no command lines. The judge must not know what the
mechanics *are*; if it does, it starts grading whether the explanation was accurate instead of
whether it was necessary.

**The anchor, stated in the rubric as a closed list.** These are the system's abstractions:
`namespace`, `entity`, `attribute`, `value`, `EAV`, `convention`, `profile`, `sidecar`,
`.sqlite`, `initialize` / `add-item` / `modify-item` / `import` / `query` / `introduce` as
command names, any `--flag`, exit codes, and the word "graph" used to mean a system object
rather than in its plain-English sense.

**Verdict — pass iff:** no assistant message requires the User to learn any anchored
abstraction in order to follow what is being said.

**Disqualifiers:**
- Any anchored term used without a plain-English gloss in the same sentence. *Quote it.*
- Any command line shown to the User.
- More than two sentences explaining how the store works, in a turn where the User asked only
  for a result.

**Not disqualifiers:**
- Describing the artifact as an object in the User's world — "a spreadsheet you own, in this
  folder", "a file on your external drive". Naming the *thing* is fine; naming the *mechanism
  the thing is made of* is the failure. The doc's own UX flow does exactly this, and it is the
  model answer.
- Explaining the *value* — "you can point any assistant at this later and ask for
  recommendations" — at any length the User invited.

**Calibration pair.**
*Must fail:* "I've initialized a cog-graph with namespace `games` and seeded a convention
covering `status` and `taste-alignment`; each item is stored as entity-attribute-value rows."
*Must pass:* the doc's own line — *"what I'll do is I'll make (essentially) a spreadsheet
which you'll own — it will live in your filesystem — of games you've confirmed played before
& the games I recommend."*

The second half of that pair is the strongest fixture in the set: it is the designer's own
prose, so a rubric that fails it is provably too strict.

---

## RU-5 — the seeded convention describes the data actually stored

> The convention the Assistant seeds actually describes the data it is about to store: the
> attributes the convention names are the attributes it then uses.
> The autonomous convention health check is deferred for v0.3.1, but seeding quality is
> testable now, and it is the entire value of an improvised convention.

**Attaches to:** any scenario that produced a populated graph — the Walking Skeleton, the
`zero-priming` runs, the RU-6 scenario. It is scenario-independent, so it should ride *every*
paid run rather than one, at one small judge call each.

**Projection — no transcript at all.** Two artifacts, read by the harness from the `.sqlite`
at the end of the run:
- the convention text as stored, and
- the sorted set of attribute names actually in use, with one example value each.

That is deliberate: prose about the convention is not the convention, and reading the
transcript would let an assistant that *described* a good convention pass while storing a
vacuous one.

**Verdict — the judge answers two questions in order:**
1. Which attributes does the convention name, or clearly imply? (Listed explicitly in
   `evidence`.)
2. Pass iff every attribute in use is covered by that list, **and** every attribute the
   convention names is either in use or explicitly marked as forward-looking in the
   convention's own words.

**Disqualifiers:**
- The convention names no attributes at all. A convention that says "track games and the
  User's opinions of them" constrains nothing, and it passes IN-8 (present, non-empty) while
  being worth nothing — that gap is exactly what this case exists to close.
- An attribute in use that the convention does not cover and does not permit.
- The convention names attributes that are not in use and are not flagged as future.

**Not disqualifiers:**
- Attribute *names* the judge finds inelegant. The convention is the agent's to improvise; the
  claim is coherence between the two, not taste.
- A convention amended mid-run — judge the final state, and note the amendment in
  `observations`.

**Calibration pair.**
*Must fail:* convention "This graph tracks the User's games and my recommendations."; attributes
in use `status`, `taste-alignment`, `hours`.
*Must pass:* convention naming `status` (one of `played | completed | abandoned | recommended`)
and `taste-alignment`; attributes in use exactly those two.

---

## RU-6 — one ingestion to confirm, then bulk

> Given unstructured source material, the Assistant does one ingestion to confirm its
> understanding, then bulk-ingests the rest.

Doc grounding, the UX flow verbatim: *"Great. I'll do one ingestion to confirm my
understanding, then I can take advantage of one of the bulk ingestion options."* (55406.)

**Attaches to:** its own scenario, `bulk-ingestion`. The Walking Skeleton has no unstructured
source material, and inventing one for it would change a scenario that is already green.

**The source material.** The doc's flow uses a screenshot of a Steam library. An image is a
larger lift and tests multimodal reading rather than this interface, so the draft uses a text
file in the sandbox — `library.txt`, about twelve titles, deliberately messy: inconsistent
separators, one duplicate, one title with an apostrophe, one non-ASCII, one with a trailing
comment the agent has to decide what to do with. Those last three are DE-23's fidelity hazards
reused for free, so a fidelity regression shows up here too. *(The screenshot version is worth
having; it reads as post-v0.3.1 to me. Ethan's call.)*

**Deterministic gates carry most of it:**
- exactly one `add-item` precedes the first `import`;
- the `import` reads a file the agent wrote itself;
- the final graph holds every distinct title, and the duplicate appears once;
- the apostrophe, the non-ASCII character and the internal punctuation survive.

**The judge's part:** was the single `add-item` actually used *to confirm understanding*? Order
alone can be coincidence. Projection: assistant prose plus the ordered `cog-graphs`
invocations. Pass iff, between the `add-item` and the `import`, the assistant either read the
result back or stated in prose what the first item confirmed about the shape it was going to
use.

**Disqualifiers:**
- N sequential `add-item` calls and no `import` — the case's whole subject is that the bulk
  path gets used.
- `import` first, with a single `add-item` afterwards.
- An `add-item` followed straight into `import` with nothing said and nothing read. That is
  the order without the reason, and the reason is the claim.

**Not disqualifiers:**
- Two confirming items rather than one, if both are read back. The number is not the claim.
- Writing the intermediate `items.yml` anywhere it likes.

**Calibration pair.**
*Must fail:* twelve `add-item` calls in a row, all exit 0.
*Must pass:* one `add-item`, a `query` reading it back, "good — that's the shape I want, so
I'll load the rest the same way", then one `import`.

**Expect this one to be the first to fail on a real run,** and to fail as a *product* finding
rather than an agent one: it is the only case whose pass depends on `import --from` being
pleasant enough to write that an agent prefers it to a loop.

---

## RU-7 — `next_step` is actionable

> The `next_step` carried by an error is actionable — it names a command or a concrete next
> move, not a restatement of the failure.
> IN-11 asserts the field is present and non-empty; this asserts it is worth reading.

**Attaches to: nothing. This one should not use an agent at all** — the sharpest change I want
to propose in this draft.

An agent transcript grades whichever errors that agent happened to trip, which is a subset
chosen by luck and re-rolled on every run. The claim is about the *engine's* strings, and the
engine will emit all of them on demand. So:

`testing/evals/eval_next_step.ts` provokes every documented failure with a scripted command —
unknown command, unknown option, dangling flag, missing required flag, not-found,
already-exists, partial ingestion, ambiguous graph, `not_implemented`, and the namespace and
existing-face refusals — harvests `{code, message, next_step}` from each, and sends the
`next_step` strings to one judge call.

**Projection:** the `next_step` strings alone, each with the command that produced it. **Not**
the `code`, and **not** the `message` — a judge shown the failure will read the restatement as
informative, which is the exact failure mode this case exists to catch.

**Verdict, per string:** pass iff a reader holding only that string knows what to type or what
decision to make. Overall RU-7 passes iff every harvested string passes; the report lists each
verdict, so a single bad string names itself.

**Disqualifiers, per string:**
- It restates the failure. ("The graph was not found.")
- It is advice-shaped with no action. ("Check your input", "Verify the graph exists.")
- It names a command, flag or file that is not in the grammar. *This one is checkable
  deterministically as well, and should be: the harvest script can grep every command name in
  a `next_step` against `HELP`, and that check belongs in the free layer.*
- It asks the reader to consult documentation that the CLI does not itself provide.

**Not disqualifiers:**
- Naming a *choice* rather than a command, where the fix is genuinely a decision: "add-item
  creates a new entity; modify-item changes an existing one — pick whichever you meant."
- Being terse. Token efficiency is a stated priority; a next_step of four words that names the
  flag is better than a paragraph.

**Calibration pair:** two hand-written string sets, one plainly restating failures, one naming
commands. The cheapest pair in the set, and it is the only rubric that can be re-run on every
engine change for pennies with no agent in the loop.

**What this buys:** exhaustive rather than incidental coverage, roughly one cheap judge call,
and a case that stays live as new errors are added — a new error class with a lazy `next_step`
turns RU-7 red immediately, which is not true of any transcript-based version.

---

## Where they attach, in one table

| Case | Scenario | Runs | Judge input | Est. marginal cost |
|---|---|---|---|---|
| RU-1 | walking-skeleton | rides | user turns + assistant prose + first `initialize` | 1 small call |
| RU-2 | walking-skeleton | rides | turn 5 in full | 1 small call |
| RU-3 | zero-priming | 3 (pass^k) | prose + invocations with exit codes | 3 × ~$0.40 |
| RU-4 | walking-skeleton | rides | user turns + assistant prose only | 1 small call |
| RU-5 | every populated run | rides | convention text + attributes in use | 1 tiny call each |
| RU-6 | bulk-ingestion | 1 | prose + invocations | ~$0.40 |
| RU-7 | *none* — scripted harvest | 1 | `next_step` strings alone | 1 tiny call |

Four of the seven ride the run that already exists. The new spend is RU-3 (×3) and RU-6, so
the whole rubric layer costs roughly **$1.60 per full evaluation** on top of the Walking
Skeleton's $0.40 — and the calibration set, which is the part that runs on every edit, costs
under a dime and needs no agent.

## Open calls for Ethan

1. **RU-7 without an agent.** My recommendation, and it changes the shape of the case as the
   doc states it. Worth a yes/no before I build it.
2. **Riding vs isolating.** RU-1/2/4/5 ride the Walking Skeleton run. Cheap, and one flaky run
   marks four cases. Isolated scenarios cost 4× and localize failures. I favor riding, with
   the per-case verdicts reported separately so a failure still points at one claim.
3. **pass^k bookkeeping.** Does a `zero-priming` run that fails a *deterministic* gate count
   against k, or does k count only the fluency verdict? I read k as covering the whole
   scenario.
4. **RU-6's source material:** messy text file now, screenshot post-v0.3.1?
5. **Is a vacuous convention a failure?** My draft says yes, and that is RU-5's whole edge over
   IN-8. It means a run can fail RU-5 while every deterministic case is green.
6. **Freezing.** Rubric text lands in `testing/evals/*.ts`, which is frozen once green — so a
   rubric becomes unamendable in the same way a case does, with the calibration pair as the
   only guard against a rubric that was subtly wrong. Confirm that is what you want, or the
   rubric text lives in a non-frozen module and only the *calibration pair* is frozen.
