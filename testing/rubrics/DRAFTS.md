# The rubric layer (RU-1..RU-7): drafts for review

> **Status**: draft, 2026-09-10. Nothing here is implemented or frozen. The claims come from
> the design doc (Testing & Evaluation > RU). The rubric text, the graders and the
> fixtures are proposals to develop with Ethan. Once a rubric is agreed and green it
> becomes spec, like any other case.
>
> Written independently of `testing/RUBRICS.md` (an earlier false start, deliberately not
> read). Where the two disagree, neither has standing until Ethan picks.
>
> Every observation about agent behavior below comes from one run:
> `testing/artifacts/walking-skeleton-2026-09-09T20-59-01Z` (PASS, 21 gates + IN-5,
> $0.39). One run is one sample. The observations are used as anchors, not statistics.

---

## Three things that one passing run already says

Reading the transcript of the passing run (Step 6 of the evals article: *read the
transcripts*) turned up three problems before any rubric was written. Each one changes a
draft below.

**1. The Walking Skeleton passed without modifying anything.** The doc's step is
"modifying a couple items". **0 of the run's 15 tool calls are `modify-item`.** In turn 3
the User said Portal 2 was "loved" and Hades was something they "bounced off". The agent
recorded `status: played` and `status: dropped`. In turn 5 ("I gave up on Hades for good,
and I finally finished Portal 2") the cold thread read the graph and answered *"Nothing
needed changing"*. The turn-5 gate matches `/complete|finished|played|done/` and
`/abandon|dropped|gave up|quit|shelved/` against the item's values, and the values
written in turn 3 satisfy both. So the case is green, and the claim it exists to make was
never exercised. It is filed in `testing/DISPUTES.md` as a landed case that looks wrong.
The fix is in the scenario's user lines, which are frozen, so it is Ethan's call.

**2. The primer's worked example *is* the scenario.** `INTERFACE_SKILL_PRIMER` in
`engine/main.ts` uses `namespace: game-recs`, `description: Games Ethan has played and
what he thought of them.` and a convention of `status` and `taste-alignment`. The agent
wrote `namespace: game-recs`, `description: Games Ethan has played and what he thought of
them, plus a backlog…`, and a convention built on `status` and `taste-alignment`. It even
used the name Ethan, which the User never gave. (The sandbox path `C:\Users\Ethan\…`
could also have supplied it.) The example came from the doc's own UX flow, so it is
honestly sourced. But on this scenario RU-1 and RU-5 cannot tell *designed a profile for
this User* apart from *copied the example*. That is test-set leakage.

**3. The primer asks for the over-explanation that RU-4 forbids.** The primer says
*"Establish the profile with the User conversationally — namespace, use-pattern, and a
description in their words."* In turn 1 the agent did exactly that. It asked the User to
confirm `namespace: game-recs` and `use-pattern: manual`, and promised to set up a
"convention". A User who wants game recommendations has no use for "use-pattern", and
v0.3.1 has only one. RU-1 and RU-4 pull against each other *inside the engine's own
text*, so the line between them has to be drawn before either rubric can be graded
consistently. Decision **D2** below.

---

## Shared design, which applies to every judge

### What the judge sees: everything

Per Ethan, 2026-09-10: judges get full context and are trusted to judge without bias, as a
human judge would. Concretely, each judge gets:

- the in-loop agent's **system prompt and toolset**. A judge cannot assess "zero
  priming" or "over-explaining" without knowing what the agent was told.
- **every user turn, every assistant message, and every tool call and tool result,
  verbatim.** No truncation. `transcript.md` truncates every call and result to 300
  characters, so it is **not** fit to feed a judge. The judge view is a new, complete
  rendering.
- **fresh-thread boundaries, marked.** For example: "a new session begins here; the agent
  below has not seen anything above".
- **the outcome.** This is the final state of every graph in the sandbox (profile,
  convention, every item and attribute), read from the artifact the same way the
  checkpoints read it. The article is explicit: the transcript says what the agent
  claimed, and the outcome is what exists.

**Internal reasoning is not in the transcripts, so nothing needs excluding on that
account.** The run holds 8 `thinking` blocks, and every one has an empty `thinking`
field. Only the encrypted `signature` survives (408–2,500 chars each). The renderer drops
them because they contain nothing.

**The only thing left out is harness plumbing:** `system/init` messages,
`rate_limit_event`, `system/thinking_tokens` counters, and per-turn usage and cost. None
of it is conversation or behavior, and DE-24 already grades the cost. This is a list, not
a filter, and it is Ethan's to veto (**D1**).

### How a judge answers

- **One isolated judge per rubric**, never one judge for all seven. The article
  recommends grading each dimension separately, and a shared call lets a strong verdict
  on one dimension color another.
- **Structured output, in this order: evidence, reasoning, verdict.** The evidence field
  is a list of `{turn, quote}` pairs. The verdict is written last so that it follows from
  the evidence rather than the other way round.
- **`verdict ∈ pass | fail | unknown`.** `unknown` is the judge's way out when the view
  cannot support a verdict, for example when the run halted before the relevant turn. An
  `unknown` never counts as a pass. It is reported separately, because the article says
  it usually means a broken task, not an incapable agent.
- **Judge model: `claude-opus-5`.** The in-loop agent is `claude-sonnet-5`. Judging costs
  a few cents per rubric per transcript *(reasoned, not measured)*.
- **Scoring follows the doc:** pass@1 for every rubric case except RU-3, which is pass^3.

### When judging happens: offline, over stored artifacts

Judging is decoupled from running. A proposed `bun run eval:judge [artifact dir]` grades a
transcript that already exists, the same way `verify:claims` re-checks SDK claims against
one. This does three things:

1. A rubric can be iterated against a fixed transcript without paying for another agent
   run.
2. The Walking Skeleton eval stays as it is. It is frozen, and wiring its `grade()` slot
   would edit its literal.
3. A judge can be red-tested on a *fixture* transcript, which is the next point.

### Red first, for a rubric: minimal pairs

A rubric that has never failed a transcript has not been shown to test anything, just as
with a test case. So each rubric lands with **two fixtures and needs both answers
right:**

- **pass fixture:** a real transcript that meets the claim (usually the 20-59 run, or a
  segment of it).
- **fail fixture:** the *same* transcript with **one targeted change** that breaks
  exactly this rubric's claim and nothing else. Where the change touches the outcome, the
  outcome section is changed to match.

A minimal pair is the rubric-shaped version of a probe. If the judge passes the fail
fixture, the rubric is too vague to rule anything out. If it fails the pass fixture, it
is rejecting a valid solution. Both are the two failure modes the article warns about,
caught for pennies with no agent run. The pairs double as **JU-2's reference solutions**
for this layer and as **the calibration set**: Ethan labels each fixture, and a judge that
disagrees with him on any of them is not trusted yet.

Once green, the rubric text and its fixtures are frozen, and their paths join
`guard-frozen.ts`.

---

## RU-1: the profile is established *with* the User

**Claim (doc):** The Assistant establishes the profile configuration *conversationally*
with the User rather than inventing it.

**What it rules out:** an Assistant that decides on the User's behalf what their data is
*for* and *where it lives*, which is the two things only the User can know. The doc's UX
flow has the User answer "put it on my external drive". Neither the purpose nor the
location is the Assistant's to assume.

**Already covered by code:** Walking Skeleton turn 1 asserts that no graph exists before
the User agrees. The judge adds what code cannot see: **whether what was built is what was
agreed.**

**Evidence:** Walking Skeleton turns 1–2, plus the outcome's profile.

**Judge question:** *Before the graph was created, did the User see and accept the purpose
of the graph and where it would live, either by being asked or by being offered a concrete
proposal they agreed to? And does the profile that was written match what was agreed,
with nothing material added that the User never saw?*

- **pass:** purpose and location were proposed or asked, and the User accepted them. The
  written profile matches the conversation. Proposing defaults for the User to confirm
  counts, and is arguably the ideal, because it costs the User least.
- **fail:** the graph was built with a purpose or location the User never saw, or the
  written profile contradicts what was agreed (the User said "external drive" and it was
  built in the cwd, or the description adds a scope the User never heard).
- **unknown:** no graph was created, or the run halted before turn 2.

**This run:** pass. Turn 1 proposed a namespace, a description and "just tell me the
folder". Turn 2's User said "That's perfect! Yes, set it up right here". The profile
matches. Finding 2 applies, though: on this scenario a pass cannot be told apart from
transcription of the primer.

**Fail fixture:** keep every turn, but change the written profile's `description` to add a
scope never mentioned ("…and a wishlist of games to buy"), in both the Write call and the
outcome.

**Open:** which profile fields are the User's to settle and which are the Assistant's.
This is the RU-1/RU-4 line, **D2**.

---

## RU-2: the cold thread orients itself

**Claim (doc):** The cold thread orients itself and reaches the right items using only the
CWD and the tooling.

**What it rules out:** an interface whose state is only legible to the session that
created it. The fresh thread is the doc's test of *data over behavior*: the artifact plus
the CLI must be enough.

**Evidence:** the fresh-thread segment (turns 5–6). Turns 1–4 are shown too, marked as
unseen by this agent, so the judge knows which items "the right items" are.

**Judge question:** *Starting with no memory, did the agent find the graph and the items
the User meant using only what was in the working directory and what the CLI told it,
without asking the User for anything the artifact already held?*

- **pass:** it located the graph (through `introduce`, `--help`, `query`, a directory
  listing or reading the `.md` sidecar, all of which are legitimate) and identified the
  entities the User meant.
- **fail:** it asked the User for the graph's name, location or contents. It acted on the
  wrong entity, created a second graph, or wrote to the `.md` sidecar. Or it concluded
  there was no graph when there was one.
- **unknown:** the run never reached a fresh thread.

**This run:** pass. `--help`, then `introduce` (which found `game-recs` from the cwd),
then `query`, then `ls`. It found both items without asking. What it then *did* is a
different question, and no rubric asks it. That is **D8**.

**Fail fixture:** replace turn 5's tool calls and reply with the agent asking *"Which list
do you mean, and where did we save it?"*

---

## RU-3: zero-priming fluency, pass^3

**Claim (doc):** An agent given only the binary name and a goal (no skill, no primer)
reaches a working graph. **Scored pass^k, k=3.**

**Proposal: grade it with code, not a judge.** "Reaches a working graph" is an *outcome*,
and the article's first rule is deterministic graders wherever possible. The one
condition a judge might seem needed for, "only the binary name", is enforced by the
harness rather than observed: the system prompt names the binary and nothing else, and no
plugin or skill is loaded. Everything the agent learns it has to pull from the CLI.
`introduce --interface-skill` found through `--help` *is* the CLI documenting itself, so
it is allowed.

**Working graph, as gates:** exactly one graph exists in the sandbox. It holds every item
the goal named, each with at least one attribute. The agent read it back through
`cog-graphs query` with exit 0. The `.md` sits beside the `.sqlite`.

**Scenario:** a dedicated, single-turn one, *"Make me a list of the three houseplants on
my windowsill (a fern, a pothos that needs water weekly, and a cactus I keep forgetting
about) so I can keep track of them."* That is a domain the primer does not use (finding
2). It costs roughly $0.05–0.10 per trial *(reasoned)*, so three trials cost much less
than rerunning the Walking Skeleton three times. The Walking Skeleton is already one
RU-3 trial and can be counted as supporting evidence, never as one of the three.

**Fail fixture:** not needed. The gates are code, so their red is established the way any
gate's is: run them against a sandbox with no graph.

**Open:** **D5**, whether a case in the RU bucket may be graded entirely by code.

---

## RU-4: the Assistant does not over-explain the mechanics

**Claim (doc):** The Assistant does not over-explain the mechanics to the User. *Anchored:
the judge is shown the user turns and asked whether any assistant message would require
the User to learn a system abstraction in order to follow it.*

**Reading the anchor under full context:** the anchor fixes *the question*, not what the
judge is allowed to see. The judge sees everything and answers from the User's seat. The
doc's standard: *"a tool which requires the User to learn it is a tool the User will leave
behind."*

**Judge question (the anchor, made concrete):** *For each assistant message, would the User
have to learn a Cog-Graphs abstraction in order to follow it or to answer it? That means
namespace, use-pattern, profile, convention, entity/attribute/value, EAV, sidecar,
functional/inspectable face, flags, or exit codes.*

- **pass:** system terms appear, if at all, as incidental labels whose meaning is carried
  in plain words. Every question put to the User can be answered in the User's own terms.
  Describing the artifact the way the doc's UX flow does ("essentially a spreadsheet which
  you'll own; it will live in your filesystem") is the model answer, not a violation.
- **fail:** the User is asked to make or confirm a decision stated in system vocabulary,
  or a message only makes sense to someone who understands the mechanism.
- **unknown:** there is no assistant prose to judge.

**This run, and the anchor Ethan's call is most needed on:** turn 1 asks the User to
confirm `use-pattern: manual` and to "tweak any of the above". It explains a "convention"
as "the schema/expectations". **I would grade turn 1 a fail.** The User cannot answer the
use-pattern question in their own terms, and it has only one answer in v0.3.1. But the
engine's primer told the agent to do it (finding 3), so a fail here is a finding about the
primer as much as the agent. Turns 2–6 would pass: the mechanics are explained once,
plainly ("a readable copy for you to skim"), and then it just works.

**Fail fixture (unambiguous):** append to turn 2's reply a paragraph explaining that the
graph is an EAV store with entities, attributes and values, and asking whether the User
wants the `manual` or `managed` use-pattern. The pass fixture is the same run with turn 1
rewritten in plain words, a pairing that only exists once D2 is settled.

---

## RU-5: the seeded convention describes the data

**Claim (doc):** The convention the Assistant seeds actually describes the data it is
about to store: the attributes the convention names are the attributes it then uses.

**What it rules out:** a convention that is decoration. The doc's convention is
"agent-improvised" in v0.3.1, and its whole value is that the next session reads it and
stores data the same way. A convention the data ignores teaches the next session
something false.

**Grader: hybrid.** Code extracts the two things being compared. The *seeded* convention
is the one written at `initialize`, taken from the transcript's Write call or the first
`introduce`. The attribute names and values actually stored come from the outcome. Code
hands the judge a table of them alongside the full view. The judge does the part code
cannot, which is reading free prose for which attributes it names and which value
vocabularies it closes.

**Judge question:** *Does the convention describe the items that were then stored? Are the
attributes the items carry named or clearly covered by the convention, and are the
convention's central attributes actually used? Where the convention states a set of
values, do the stored values stay within it?*

- **pass:** stored attributes ⊆ what the convention covers, and the convention's core
  attributes appear on the items. An attribute the convention marks as situational ("when
  I have them") may go unused.
- **fail:** items carry attributes the convention never mentions, the convention's core
  attributes are absent, or values fall outside a vocabulary the convention closed.
- **unknown:** no items were stored.

**This run:** pass. The convention names `status` (played/backlog/dropped),
`taste-alignment` (loved/liked/meh/disliked), `genre`, `platform` and notes "when I have
them". The items use `status`, `taste-alignment`, `genre` and `notes`, all within
vocabulary. Finding 2 weakens that pass. Finding 1 is worth noting here too: the closed
`status` vocabulary has no "finished" value. That is consistent with the cold thread
judging that "finally finished" changed nothing. A convention can faithfully describe the
data and still be too coarse to hold what the User says. That is the doc's
source-fidelity principle, and it belongs to **D8** rather than RU-5.

**Fail fixture:** change the two turn-3 `add-item` calls, and the outcome, to use
`rating` and `completion` in place of `taste-alignment` and `status`, leaving the
convention as seeded.

---

## RU-6: one ingestion to confirm, then bulk

**Claim (doc):** Given unstructured source material, the Assistant does one ingestion to
confirm its understanding, then bulk-ingests the rest.

**What it rules out:** in one direction, N `add-item` calls where one `import` would do,
which is the token-efficiency priority. In the other, a blind bulk import of a mapping
nobody checked, where one bad guess is multiplied N times.

**Scenario: new, and needed.** No existing run has unstructured source material. The
proposal is a fixture file in the sandbox, a messy free-text dump of about 12 games in
the style of a notes-app export, with inconsistent phrasing. A single user turn asks for
them all to be put in a list. Because this path *is* the claim (the doc's UX flow spells
it out), it is one of the rare cases where grading the path is right, and the article's
warning against path-grading is noted and set aside for that reason.

**Grader: hybrid.**
- **code (outcome):** all ~12 fixture items are present with attributes, and at least one
  `import` ran successfully.
- **judge:** *Before bulk-ingesting, did the Assistant ingest a single item and check the
  result, then bring in the rest in bulk? If the single ingestion revealed a problem, was
  the bulk adjusted to account for it?* The `add-item` output echoes the stored
  attributes, so reading that output counts as checking. A separate `query` is not
  required.
- **pass:** one item individually, the result looked at, and the remainder in bulk.
- **fail:** every item individually, or a bulk import with no prior single check.
- **unknown:** the engine rejected the import for a reason the agent could not control.

**The balanced counterpart costs nothing.** Walking Skeleton turn 3 (two items, two
`add-item`s, no import) is the other side of the same behavior: a couple of items should
*not* get a bulk ritual. The article warns that one-sided evals produce one-sided
optimization. Proposed as a second question for the same judge over the Walking Skeleton
transcript, and flagged as a proposal because the doc only states the positive direction
(**D6**).

**Fail fixture:** available only once a real RU-6 transcript exists. Replace the
single-item check with `import` of all twelve straight away.

---

## RU-7: `next_step` is worth reading

**Claim (doc):** The `next_step` carried by an error is actionable. It names a command or a
concrete next move, not a restatement of the failure. (IN-11 asserts the field is present
and non-empty. This case asserts it is worth reading.)

**Proposal: no agent at all.** Every error the engine emits is a deterministic output of a
deterministic invocation, so the transcript of a live agent adds only noise and cost. The
engine has **28 `fail()` call sites across 21 distinct codes**, plus 3 warning codes that
also carry a `next_step` (counted by regex over `engine/main.ts`, 2026-09-10).

**Three parts:**
1. **A catalog** (free, `bun test`): one failing invocation per error code, each run
   through the real CLI. Its own test checks that **every code in the engine has an
   entry**, so a new error cannot ship without being graded. This half is falsifiable in
   the usual way: add a `fail()` with a new code and the coverage test goes red.
2. **A code pre-grader** (free): if a `next_step` names `cog-graphs <command>` or a flag,
   that command must answer `--help` at exit 0 and advertise that flag. A pointer to
   something that does not exist is a fail, with no judge needed.
3. **A judge per error**, whose view holds the invocation, the complete error object, that
   command's `--help` and the top-level `--help`. That is full context, the same as an
   Operator would have.

**Judge question:** *An Operator has just received this error and knows nothing but what is
in front of it. Does `next_step` tell it what to do next, as a command, a flag, a value or
a concrete action, rather than restate what went wrong?*

- **pass:** it names the move (for example, `ambiguous_graph`, which names the candidates
  and says to pass `--graph` with one of them).
- **fail:** it restates the message, gives generic advice ("check your input"), or names
  something that does not exist.
- **unknown:** the error object is malformed. That should be impossible given IN-11.

**The case passes** when every catalog entry passes. The outputs are deterministic, so the
only nondeterminism is the judge's.

**Fail fixture:** a synthetic error whose `next_step` repeats its `message` word for word.

---

## Seams, for confirmation before any test is written

Per `/tdd`, tests go only at agreed seams. Proposed:

| Seam | What crosses it | Layer | How its red is established |
|---|---|---|---|
| **S1** `renderJudgeView(artifactDir)` | stored run → the complete text a judge sees | free | a test over the 20-59 artifact: every tool result appears verbatim, every user turn appears, the fresh-thread marker is present, the outcome section lists every item, no plumbing appears. It goes red today because the function does not exist, and red on a truncating renderer, which is what `renderMarkdown` is. |
| **S2** `judgeRubric(rubric, view)` | view + rubric → `{evidence, reasoning, verdict}` | paid, cents | the minimal pair: the fail fixture must come back `fail` |
| **S3** `errorCatalog()` | engine → every `(invocation, error, help)` | free | the coverage test: every `fail()` code has an entry |
| **S4** RU-3 / RU-6 scenarios | live agent → sandbox outcome | paid | gates run against an empty sandbox first |

`judge.ts` stays the SDK slot it is. S2 wraps it with the rubric preamble and schema.

## Proposed order of slices

1. **S1, the judge view.** Free. Everything else consumes it.
2. **RU-7.** No agent run, mostly free, and it grades the thing Operators touch most.
3. **RU-2, RU-5, RU-1.** Judges over the existing 20-59 transcript, each with its minimal
   pair. Cents, no agent runs.
4. **RU-4**, once D2 is settled, since its pass fixture depends on it.
5. **RU-3**: the new scenario × 3.
6. **RU-6**: the new scenario and fixture.

## Decisions for Ethan

- **D1**: Is harness plumbing (init, rate-limit events, token counters, usage/cost) the
  only thing left out of the judge view? Anything else would need a stated reason.
- **D2** *(the one that matters most)*: **Which profile fields are the User's to settle?**
  Proposal: *purpose* and *location* are the User's. *Namespace*, *use-pattern* and
  *convention* are the Assistant's to choose and mention, at most, in passing. Accepting
  that means changing the primer's "Establish the profile with the User conversationally
  — namespace, use-pattern, and a description" (an engine change), and it is what makes
  RU-1 and RU-4 agree.
- **D3**: **The primer's example domain.** Either move the primer's worked example off
  games, which is an engine change leaving the doc's UX flow untouched, or keep it and give
  RU-1/RU-5 a scenario in another domain. I'd move the example: every future scenario in
  that domain inherits the leak.
- **D4**: **The Walking Skeleton turn-5 dispute** (`testing/DISPUTES.md`). Proposed
  resolution: make turn 3's user line leave room for a change (e.g. "Portal 2, which I'm
  about halfway through"), and append a gate asserting that at least one item's values
  differ between the checkpoints either side of turn 5.
- **D5**: RU-3 graded by code, on a dedicated cheap scenario. Fine for a case in the RU
  bucket?
- **D6**: RU-6's negative direction (don't bulk-import two items), graded over the
  Walking Skeleton for free. Wanted, or outside the doc's claim?
- **D7**: RU-7 without a live agent. Fine?
- **D8**: **Does anything grade "did what the User asked"?** RU-2 grades orientation,
  and the gates grade the values present. In this run the cold thread found the right
  items, told the User nothing needed changing, and lost "finally finished" and "for
  good", both new information. It passed everything. Nothing in RU-1..RU-7 would catch
  it. A candidate mint: **RU-2.1**, *the cold thread carries out the User's request with
  the information they gave, and when it concludes no change is needed, that conclusion
  is correct.* It is a rubric, so its wording is Ethan's to approve before it is minted.
- **D9**: Judge model `claude-opus-5`, and `unknown` counted as not-a-pass but reported
  separately. Agree?
