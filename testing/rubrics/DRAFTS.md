# The rubric layer (RU-1..RU-7): drafts for review

> **Status**: third draft, 2026-09-11; RU-5.1 minted and RU-7 settled the same day. Nothing here is implemented or frozen. The claims
> are the design doc's (Technical Specification > Testing & Evaluation > RU), and the rest
> is proposal. Revised after Ethan's notes of 2026-09-11: the judge gets more latitude, and
> the drafts are anchored in the doc rather than in the runs we happen to have.

## What these cases are for

An RU case exists because its claim cannot be turned into a check without losing it. Was
the conversation collaborative? Did an explanation burden the User? Did the ingestion
strategy suit the material? A judge can weigh these the way a thoughtful human reviewer
would, in context and by taste. A rubric's job is to tell the judge what the doc intends
and then get out of the way.

So each rubric below gives the **claim**, the **intent** behind it in the doc's own
terms, what the judge should **weigh**, and the **anti-pattern**. None of them is a
checklist. Where a draft names examples, they illustrate; they are not criteria. The
verdict belongs to the judge.

Evals enforce the doc and guard against regression. They do not change behavior; the
implementation does. A rubric that today's engine would fail is doing its job, because it
names what the implementation still owes.

---

## Shared design

### What the judge sees

Roughly what the User would have been exposed to:

- the conversation as it appeared: user turns, assistant messages, and every tool call
  with its result, verbatim;
- each new thread marked where it begins;
- the graph's **inspectable face** (`<namespace>.md`) as it stood at the end of the
  run. That is what a User who went looking would find, and it carries the profile, the
  convention and every item;
- a short scenario preamble saying what the agent was given at the start.

Harness bookkeeping is left out, because it is not part of the interaction: session-init
messages, rate-limit events, and token and cost counters. `transcript.md` truncates tool
results to 300 characters, so the judge view needs its own rendering.

### How a judge answers

- **One judge per rubric**, each in its own call.
- **Reasoning first, with quotes, then the verdict.** The verdict is `pass`, `fail` or
  `unknown`. `unknown` is for material that cannot support a verdict, such as a run that
  halted before the moment in question. It never counts as a pass, and it is reported
  separately.
- **Judge model `claude-sonnet-5`** (Ethan, 2026-09-11), the same model as the in-loop
  agent. The reference pairs are hand-written, so any lean a judge has towards its own
  model's style shows up there first, as a pair it gets wrong.
- **Scoring:** pass@1 for every case except RU-3, which is pass^3, as the doc specifies.
- **Offline, over stored artifacts.** A proposed `bun run eval:judge [artifact dir]`
  grades a run that has already happened. A rubric can then be iterated without paying for
  another agent run, and the frozen scenario files stay untouched.

### Red first

Each rubric lands with a **pair of reference transcripts**, hand-written for the purpose:
one that plainly meets the claim and one that plainly breaks it. The judge has to get both
right. They are written by hand rather than lifted from past runs, because a reference
should show what the doc means, not what one agent did against an engine and a scenario
that are both still being tightened.

Ethan's labels on the pairs are the calibration set, and the pairs are JU-2's reference
solutions for this layer. A rubric and its pair are frozen once green.

---

## RU-1: the profile is established with the User

**Claim:** The Assistant establishes the profile configuration *conversationally* with the
User rather than inventing it.

**Intent:** The profile is "the identity of a particular instance … the part that depends
upon each use-case", and "if a human is directing their Assistant, the Assistant should
conversationally establish the configuration options with them." A graph is something the
User will own and come back to, and what it is for is theirs to say.

**In v0.3.1:** the cases and UX flows are written for the full vision, which has a
manual and a managed use-pattern. v0.3.1 keeps that structure in the code but has only
one pattern, and nothing Operator- or User-facing presents it, so it is not among the
things established here. The rest is the judge's to weigh.

**Material:** the Walking Skeleton, from the first turn through `initialize`.

**Weigh:** whether the profile that was written is one the User had a hand in, through
questions or through proposals they accepted, or whether its details were decided alone
and presented as done. How much to ask is the Assistant's call. A good Assistant infers
what it reasonably can and asks for what only the User knows.

**Anti-pattern:** inventing the details.

---

## RU-2: the cold thread orients itself

**Claim:** The cold thread orients itself and reaches the right items using only the CWD
and the tooling.

**Intent:** Communication with an agent "is often stateless in nature", so durable data
belongs outside the chat log. The Walking Skeleton's fresh thread tests whether it is: the
artifact and the CLI must be enough on their own.

**Material:** the Walking Skeleton's fresh-thread segment. The earlier turns are shown too,
marked as unseen by this agent, so the judge knows which items the User means.

**Weigh:** did it find its footing from what is on disk and what the CLI told it, and land
on the items the User meant, without leaning on the User for anything the artifact already
held?

**Anti-pattern:** a cold thread that has to be told what the previous one knew.

---

## RU-3: zero-priming fluency

**Claim:** An agent given only the binary name and a goal (no skill, no primer) reaches a
working graph. **Scored pass^k, k=3.**

**Intent:** "The CLI should be feature complete and totally self-documenting,
self-contained; an AI Agent should be able to pick it up with zero priming and get to a
fluent level of control." This is the one case whose whole claim is reliability.

**Material:** a dedicated scenario run three times, independently. The agent is told only
that `cog-graphs` is on its PATH, and the User states a goal in their own words, in a
domain no primer or help example uses.

**Weigh:** did the agent get from nothing to a working graph by learning the CLI from the
CLI? That means one created where it belongs, holding what the User asked for, and read
back. Fumbling on the way is fine. The claim is that it arrives, every time.

**Anti-pattern:** stalling, giving up, working around the tool, or needing the User to
explain it.

---

## RU-4: the Assistant does not over-explain the mechanics

**Claim:** The Assistant does not over-explain the mechanics to the User. *Anchored: the
judge is shown the user turns and asked whether any assistant message would require the
User to learn a system abstraction in order to follow it.*

**Intent:** "A tool which requires the User to learn it is a tool the User will leave
behind." The Assistant is the interface. The User speaks in their own terms, and the
system's abstractions are the Assistant's to carry.

**Material:** every assistant message in the Walking Skeleton.

**Weigh:** per the anchor, read from the User's seat. Would following or answering any
message require the User to learn a system abstraction? Naming a thing is not the failure.
Making the User carry it is.

**Anti-pattern:** handing the User the mechanics, such as asking them to decide things in
the system's vocabulary or walking them through machinery they did not ask about.

---

## RU-5: the seeded convention describes the data

**Claim:** The convention the Assistant seeds actually describes the data it is about to
store: the attributes the convention names are the attributes it then uses.

**Intent:** The convention is "an agent-managed set of expectations which is **always**
present when an agent interacts with a Cognitive Graph", and it is agent-improvised in
v0.3.1. Its value is that the next session reads it and stores data the same way. A
convention the data ignores teaches the next session something false.

**Material:** the Walking Skeleton through its first additions: the convention as seeded,
and the items then stored.

**Weigh:** would a later session, reading only the convention, understand what is in the
graph and add to it in the same way?

**Anti-pattern:** a convention that is decoration, either written generically or written
once and then ignored.

---

## RU-6: one ingestion to confirm, then bulk

**Claim:** Given unstructured source material, the Assistant does one ingestion to
confirm its understanding, then bulk-ingests the rest.

**Intent:** The doc's UX flow: *"I'll do one ingestion to confirm my understanding, then I
can take advantage of one of the bulk ingestion options."* Ergonomics and token efficiency
are priorities, and a bulk ingestion of a misread source multiplies the misreading.

**Material:** a new scenario in which the User hands over messy source material, such as
an export or a pasted list of a dozen or so items.

**Weigh:** did the approach suit the material, checking its reading of the source on a
small sample before committing the rest in bulk? The doc's flow is the model. The judge
weighs its spirit (confirm, then scale) over its literal count.

**Anti-pattern:** going item by item through a large batch, or bulk-ingesting a mapping
that was never checked.

---

## RU-7: `next_step` is worth reading

**Claim:** The `next_step` carried by an error is actionable. It names a command or a
concrete next move, not a restatement of the failure. (IN-11 asserts the field is present
and non-empty. This case asserts it is worth reading.)

**Intent:** Errors are "AI legible … errors detail next steps / possible issues", and the
CLI "returns intuitive, rich feedback in all cases which suggests next steps when
relevant". An error an Operator cannot act on costs it a turn.

**Material:** a direct sweep with no live agent (settled with Ethan, 2026-09-11). Each
error code the engine can raise is provoked once by direct invocation — 21 codes at the
last count, by regex over `engine/main.ts` on 2026-09-10 — and put before the judge
blind: the invocation, the complete error, and that command's `--help`, which is all an
Operator meeting it would have. The sweep's own free test asserts that every code in the
engine has an entry, so a new error cannot ship ungraded.

**Weigh:** given only what is in front of it, could an Operator act on the `next_step`?

**Anti-pattern:** a `next_step` that restates the failure, or points nowhere.

The case passes when every error in the sweep does.

---

## RU-5.1 (minted 2026-09-11): what the User says reaches the graph

**Claim:** What the User tells the Assistant about an item reaches the graph with its
meaning intact, including what is new when they update it.

**Intent:** "Source data at source fidelity is the default assumption — phrasing, tacit
knowledge, metaphors — contradictions and all." And from Just-in-Time Intelligence: "The
fatal failure mode with modern AI is interpretations over interpretations," so inference
is deferred to retrieval. Also: "quality of the data within only builds, never regresses."

**Why the gap survives the notes of 2026-09-11:** once the Walking Skeleton's user turns
are tightened, the fresh thread will have a real modification to make, and the gates will
check deterministically that values changed. That closes *whether it modified*. It does not
close *whether the meaning survived*. DE-23 guards fidelity at the CLI, where strings
round-trip. RU-5 asks whether the convention describes the stored data. Nothing asks
whether the stored data describes what the User said. An Assistant can modify an item and
still flatten "I gave up on it for good" into a bare status, which might be exactly right
or might lose what the User cared about. That is a taste call, which is what this layer is
for.

**Material:** the Walking Skeleton's additions and modifications, and the final `.md`.

**Weigh:** would the User, reading their graph, recognize what they told the Assistant?
Distilling is expected, since a graph is structured, not a transcript. Losing information
the User gave, or deciding their news was not news, is not.

**Anti-pattern:** flattening what the User said, dropping an update, or interpreting at
storage time what should have been kept for retrieval.

**ID:** numbered by subject off RU-5, the data the Assistant stores, under the numbering
rule Ethan settled on 2026-09-11 (`CLAUDE.md`).

---

## Seams, for confirmation before any test is written

| Seam | What crosses it | Layer |
|---|---|---|
| **S1** `renderJudgeView(artifactDir)` | a stored run → the text a judge sees | free, `bun test` |
| **S2** `judgeRubric(rubric, view)` | view + rubric → reasoning and verdict | paid, pennies per call |
| **S3** scenarios | live agent → transcript + artifact | paid |
| **S4** `errorSweep()` | engine → every error code, provoked once, with its command's `--help` | free |

**S1 landed 2026-09-11** (`testing/tests/judge-view.test.ts`, `testing/harness/judge-view.ts`).
Building it showed that the stored record was missing half of what a judge needs: the user
turns, the thread boundaries, the preamble and the final `.md`. The runtime now writes
them to `run.json`. Runs recorded before that date cannot be judged, and the renderer says
so. S2's red is each rubric's reference pair. S3's red is the scenario's own gates.

## Proposed order

1. **S1**, the judge view.
2. **Reference pairs, then the judges for RU-1, RU-2, RU-4, RU-5 and RU-5.1** over them.
   No agent spend.
3. **Tighten the Walking Skeleton's user turns** (the resolved dispute in
   `testing/DISPUTES.md`) and re-run it. That gives the judges real material.
4. **RU-3**: the zero-priming scenario, three trials.
5. **RU-6**: the ingestion scenario.
6. **RU-7**: the direct sweep. One judge call per error code, and no agent run.

## Implementation follow-ups these drafts surfaced

These are engine work, not eval work. The rubrics guard them once they land.

- ~~**The primer goes generic**~~ **Done 2026-09-11** (Ethan's call: a targeted fix and
  no case). The primer's worked example, every `--help` example, and the
  `invalid_namespace` hint are now domain-neutral (`my-list`, `First item`,
  `status=open`). The comment above `INTERFACE_SKILL_PRIMER` says why. The primer's
  "namespace, use-pattern, and a description" line is not about a domain, so it is left to
  RU-1 and RU-4.
- **use-pattern withheld** (Ethan, 2026-09-11: "not meaningful in v0.3.1, so it shouldn't
  be presented"). The profile no longer asks for it: it defaults to `manual` and is still
  stored, so the structure survives. It no longer appears in the primer, `--help`, the
  `initialize` payload, `introduce`, or the sidecar. A comment beside `PROFILE_FIELDS`
  in `engine/main.ts` says why.

## Open for Ethan

Nothing, as of 2026-09-11.
