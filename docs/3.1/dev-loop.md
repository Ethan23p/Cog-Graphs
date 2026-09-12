# v0.3.1 — the dev loop

The record of the v0.3.1 build loop, consolidated when the loop closed (2026-09-12). It
gathers the documents the loop accrued into one place: how the loop ran, every case it
worked (including the ones it minted), the disputes Ethan resolved, and how the rubric layer
came to be worded. The engine's decisions stay beside the engine, in
`engine/IMPLEMENTATION.md`.

**The design doc wins.** The page `Cog-Graphs` in the graph `Logseq-DB-Aurelius` is the
authority for scope and cases. Where this record and the doc disagree, this record is
stale. The minted cases below are the exception in kind rather than in authority: the doc
does not list them yet, so this is their only prose record until Ethan ratifies them into
it.

The text of each part is carried over as it stood, headings shifted down a level. Its
internal pointers have been rewritten to the parts of this file; "this file" inside a part
means that part.

## Former locations

Comments in frozen files (`testing/tests/*.test.ts`, `testing/evals/*.ts`,
`testing/rubrics/*.ts`) still name the old paths, and the freeze keeps them that way. Read
them through this table.

| Old pointer | Now |
|---|---|
| `testing/CASES.md` | [Cases](#cases) |
| `testing/DISPUTES.md`, `DISPUTES.md` | [Disputes](#disputes) |
| `engine/IMPLEMENTATION.md` (earlier `engine/DESIGN.md`) | Unmoved: `engine/IMPLEMENTATION.md`, beside the engine |
| `testing/rubrics/DRAFTS.md`, `DRAFTS.md` — including the seams S1–S4 | [Rubric layer](#rubric-layer) |
| `testing/harness/IMPLEMENTATION.md` (earlier `testing/harness/DESIGN.md`) | `testing/harness/HARNESS-IMPLEMENTATION.md`, still beside the harness |
| The build-loop sections of `CLAUDE.md` | [The build loop](#the-build-loop) |

---

## The build loop

*Formerly the build-loop sections of `CLAUDE.md`, removed when the loop closed.*

State lives in the repo, not in the conversation. To pick up cold: `git log --oneline`
shows the cases already green, `bun test` shows they still are, [Cases](#cases) lists
every case there is in slice order, and the engine and harness implementation docs say why the code
looks the way it does. Nothing else needs to be remembered.

**One slice at a time, vertically.** A slice is one case, start to finish:

1. Pick the next case from [Cases](#cases), in slice order.
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
case's own words. Add it to [Cases](#cases) under **Minted** with one line on what
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
the spec honest. If a green case looks wrong, append to [Disputes](#disputes), leave it
alone, and carry on.

The guard compares lines, so **any** rewritten line is a removal, including a line you wrote
an hour ago in the same file. In practice that means: to add to a frozen file, add *new*
lines only. Do not extend an existing `import` statement — write a second one. Do not reflow
a paragraph, retitle a `describe`, or fix a typo in a comment. The guard cannot tell a
comment from an assertion and should not have to.

`helpers.ts` and everything under `testing/harness/` are **not** frozen. They are mechanism,
not spec — add a helper or a runtime feature when a slice needs one.

### The two internal docs, and the standard they are held to

`engine/IMPLEMENTATION.md` and `testing/harness/HARNESS-IMPLEMENTATION.md` record the decisions the
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

Closure, per the doc's Roadmap: all v0.3.1 cases taken red → green in good faith and
passing; the Walking Skeleton passing through the eval harness. The conclusive milestone is
Ethan's own manual pass — not yours to declare.

---

## Cases

*Formerly `testing/CASES.md`.*

Navigation aid for the build loop. **The design doc wins.** This file is a map, not the
territory: the authority is the `Testing & Evaluation` section of the page `Cog-Graphs`
in the graph `Logseq-DB-Aurelius`, and case text below is copied verbatim from it.

Extracted 2026-09-08. If a case here disagrees with the doc, the doc is right and this
file is stale — re-extract it rather than reasoning from it.

Cheap ways to re-read the source:

```bash
# the whole doc (~63 KB / ~17.6k tokens) — once per session is fine
logseq show --graph "Logseq-DB-Aurelius" --page "Cog-Graphs" --linked-references false

# just the test cases (~10.5 KB): pull the quick-ref page for current db/ids, then the
# Technical Specification section. Handy for a subagent that needs nothing else.
logseq show --graph "Logseq-DB-Aurelius" --page "Cog-Graphs Quick Reference Page" --linked-references false
logseq show --graph "Logseq-DB-Aurelius" --id <Technical Specification id> --linked-references false
```

---

### Slice order

Walking Skeleton order — the sequence an Operator meets the system in, so "the next
case" always builds the system forwards. Take them one at a time: write the case, watch
it fail, make it pass, commit.

Introduction and initialization: **DE-1, DE-2, DE-5, DE-3, DE-4, DE-6, IN-1, IN-2, IN-3,
IN-8, DE-7**
Query and single items: **DE-8, DE-9, DE-10, DE-12, DE-11, DE-13, DE-14, DE-15, DE-16,
DE-18, DE-17**
Bulk, convention, targeting, fidelity: **DE-19, DE-20, DE-21, DE-22, DE-23**
Artifact invariants over the finished surface: **IN-4, IN-5, IN-6, IN-7**
Interface invariants as a sweep over every command: **IN-9, IN-10, IN-11**
Agentic (costs money — run when deterministic deps are green): **DE-24, RU-1..RU-7**
Ethan / closure: **JU-1, JU-2**

Two notes on that order. **IN-9/10/11 are cross-cutting** — they assert a property of
*every* command, so they are written once as a sweep over `COMMANDS` late, but each new
command must keep them green from the moment it exists; do not treat them as a
late-stage cleanup. And **the RU cases and DE-24 run through the eval harness**, not
`bun test`; they need a live agent and real money.

---

### IN — artifact invariants

- **IN-1** The functional face is a valid, readable `.sqlite`; every EAV row resolves to a known entity.
- **IN-2** The inspectable face is a `.md` beside the `.sqlite`, in the same directory.
- **IN-3** The profile is present and intact inside the artifact, carrying every field the profile schema declares — not a hardcoded three.
  - Asserted against the schema so the case does not rot when the profile grows past namespace / use-pattern / description.
- **IN-4** The sidecar is derived and never read: delete it *or* overwrite it with garbage, run any command, and the engine behaves identically and regenerates it.
- **IN-5** No item present at an earlier checkpoint is absent or corrupted at a later one, except where the scenario deliberately changed it.
  - Checkpoint = a harness snapshot taken after every gate, so 'earlier' and 'later' are mechanically defined rather than left to the reader.
- **IN-6** No stray artifacts: after a full scenario the working directory holds exactly the `.sqlite`, the `.md`, and the fixtures brought in — no journals, lockfiles, caches, or temp directories left behind.
- **IN-7** Graph isolation: a checkpoint of graph B is byte-identical before and after a full add / modify / remove cycle on graph A.
- **IN-8** A convention is present inside the artifact after `initialize`, and is non-empty. It lives in the artifact, not the engine.

### IN — interface invariants

- **IN-9** Every invocation's default output parses as JSON; `--pretty` produces the human-readable form.
- **IN-10** Exit codes are meaningful on every invocation — 0 on success, non-zero on failure, distinct codes for distinct failure classes.
- **IN-11** Every non-zero exit emits a structured error object with non-empty `code`, `message`, and `next_step` fields, on a documented stream.

### DE — code / deterministic

#### Introduction & initialization

- **DE-1** `introduce` with no instance present returns the *system* introduction — how to use the system — rather than erroring.
- **DE-2** `introduce --interface-skill` returns non-empty primer content at exit 0, and the primer names every command the Walking Skeleton requires.
- **DE-3** `--managed` appears in no user-facing output: not in any command's `--help`, not in any success output, not in any error output.
- **DE-4** `--managed` supplied on input is rejected: non-zero exit, unrecognized-option error. It never silently succeeds.
- **DE-5** Every command answers `--help` at exit 0 with output that names its required flags and carries at least one runnable example.
- **DE-6** The profile stored in the artifact matches the imported `.yml` field for field.
- **DE-7** Temp-directory guard, both directions: `initialize` targeting a path under the platform temp root emits an explicit warning naming the risk; `initialize` in an ordinary directory emits no such warning.
  - The warning travels as a `warnings` array in the JSON output, so it does not break IN-9.

#### Query & single-item operations

- **DE-8** Query against the empty instance succeeds with a well-formed empty result — exit 0, not an error.
- **DE-9** After `add-item`, a direct read of the `.sqlite` shows exactly the entities and attribute/value pairs supplied — no more, no fewer.
- **DE-10** Query returns those items with their attribute/value pairs intact.
  - DE-9 reads the database, DE-10 reads through the CLI. Kept as two cases because they fail for different reasons.
- **DE-11** `add-item` on an existing entity errors and points to `modify item`.
- **DE-12** The sidecar enumerates the items after the add.
- **DE-13** After `modify-item`, both the `.sqlite` and the query reflect exactly the modified values, and attributes not named in the command are unchanged.
- **DE-14** The sidecar reflects the modification.
- **DE-15** `modify-item` on a non-existent entity errors and points to `add item`.
- **DE-16** `remove-item` removes the targeted item; a subsequent query no longer returns it.
- **DE-17** `remove-item` on a non-existent entity errors legibly rather than succeeding silently.
- **DE-18** The sidecar no longer enumerates the removed item.

#### Bulk ingestion

- **DE-19** Bulk ingestion of N items in one invocation yields exactly N items; a subsequent query returns all N with attribute/value pairs intact; the sidecar enumerates all N.
- **DE-20** A bulk ingestion containing one invalid record behaves as partial-with-report: the valid records are committed, the invalid record is rejected, and the report names the offender by identifier and by position.
  - The exit code for a partial ingestion is distinct from both clean success and total failure, per IN-10.
  - `--help` for the bulk command states the partial-with-report semantic explicitly, so an Operator is never guessing whether a batch was atomic.

#### Convention

- **DE-21** The convention is amendable: after an amend, a read-back returns the amended convention and the sidecar reflects it.

#### Graph targeting

- **DE-22** With two instances in the same working directory, omitting `--graph` errors legibly and names the candidates rather than silently choosing one; `--graph` naming a non-existent instance errors and names what does exist, or points at `initialize`.

#### Fidelity & ergonomics

- **DE-23** Source-fidelity round-trip: an entity name and attribute values containing spaces, an apostrophe, a non-ASCII character, an `=`, and an internal newline survive add → query → sidecar unchanged.
- **DE-24** Ergonomics budget: the Walking Skeleton completes within declared ceilings on agent turns, tool calls, and total tokens.
  - The harness already records all three. Starts as a generous ceiling and tightens as the numbers stabilize; it is the only guard on the stated priority of token efficiency.

### RU — AI with rubric (eval harness; costs money)

- **RU-1** The Assistant establishes the profile configuration *conversationally* with the User rather than inventing it.
- **RU-2** The cold thread orients itself and reaches the right items using only the CWD and the tooling.
- **RU-3** Zero-priming fluency: an agent given only the binary name and a goal — no skill, no primer — reaches a working graph. **Scored pass^k, k=3.**
  - Scenario: `testing/evals/eval_zero_priming.ts` (`bun run eval:zero-priming`), three
    trials over houseplants — a domain no `--help` example uses. Passed 3/3 on 2026-09-11.
  - pass^k means every trial graded by every grader, so the judge runs on all three:
    `bun run eval:judge --scenario zero-priming --last 3`. 3/3 judged pass, 2026-09-12.
    Before that date only the gates ran three times, which scored the gates and not the case.
  - This is the one case whose whole claim is reliability, so pass^k. The other rubric cases stay at pass@1.
- **RU-4** The Assistant does not over-explain the mechanics to the User.
  - Anchored: the judge is shown the user turns and asked whether any assistant message would require the User to learn a system abstraction in order to follow it.
- **RU-5** The convention the Assistant seeds actually describes the data it is about to store: the attributes the convention names are the attributes it then uses.
- ~~**RU-6** Given unstructured source material, the Assistant does one ingestion to confirm its understanding, then bulk-ingests the rest.~~ **Withdrawn 2026-09-12** (Ethan): the
  program should guide an agent that is about to bulk-import, but the agent's own restraint
  is implicit behavior and not what this suite grades. Blessed in [Disputes](#disputes); the
  rubric, its pair and the ingestion scenario are in the history at f1803a8. Struck in the
  design doc the same day (block 60258, kept in strikethrough), so doc and repo agree.
- **RU-7** The `next_step` carried by an error is actionable — it names a command or a concrete next move, not a restatement of the failure.
  - IN-11 asserts the field is present and non-empty; this asserts it is worth reading.
  - Judged over the error sweep by `bun run eval:errors`, one call per code, **manually
    invoked** after a change to the engine's errors rather than in any loop (Ethan,
    2026-09-12). 20/20 pass, $0.57, 2026-09-12. `ERROR_RUBRIC` sits outside `RUBRICS` on
    purpose: its material is one error, not a conversation, so the reference-pair rule that
    governs every conversational rubric does not apply to it.

### JU — Ethan's judgement

- **JU-1** Ethan runs the Walking Skeleton manually end to end and records concerns.
- **JU-2** Every automated case has a reference solution: a known-good command transcript that passes all of its graders.
  - Proves the case is solvable and the graders are wired correctly, so a 0% pass rate is never misread as an incapable engine.

---

### Minted — holes found by the loop

Cases the doc does not list, covering behavior it already implies. Minted under the rule
in [The build loop](#the-build-loop) ("A hole in the cases is the next slice"). IDs are sub-numbered by subject
first (the case whose claim they extend) and by the slice in progress second. The
DE-19.1–19.8 block predates that rule and keeps its provenance numbers. These are frozen
once green like any other case, and are pending Ethan's ratification into the doc.

- **DE-10.1** Selection filtering: `query --attr k=v` returns only items carrying that
  pair, `--exclude k=v` drops items carrying it, and repeated flags compose.
  - Found at DE-10. The grammar line and the `selection` search strategy are both
    ratified in the doc, and DE-5/DE-4 force both flags into `--help` and into the
    recognized-options list — but nothing graded what they *do*. It is the doc's only
    search strategy for v0.3.1.
- **DE-19.1** `introduce --graph <ns>` against an existing graph returns the *instance*
  introduction, naming what the graph is for and the convention it keeps.
  - Found by `/code-review` at the DE-17 → DE-19 boundary. The engine ignored `--graph`
    and answered "There is no Cog Graph here yet" over a graph that was present.
- **DE-19.2** Every invocation answers on a stream: bare `cog-graphs`, `cog-graphs
  --help`, and an unknown command each produce output rather than silence.
  - Same review. All three exited 1 with empty stdout *and* empty stderr, which is the
    first thing RU-3's zero-priming agent meets.
- **DE-19.3** *(amended 2026-09-09 by Ethan's resolution — sweep now derived from the
  CLI rather than a literal, so it retires itself as commands land; see [Disputes](#disputes))* A
  command that exists in the grammar but is not yet implemented fails with
  an explicit `not_implemented` error carrying a `next_step`.
  - Same review. `import` and `convention` are graded by DE-5 as deliverables and
    answered with nothing at all.
- **DE-19.4** A namespace must be a single non-empty path segment; `../escape` and
  whitespace-only names are refused.
  - Same review. `namespace: ../escaped` wrote outside the target directory and reported
    success — the failure the temp-directory guard exists to prevent.
- **DE-19.5** `initialize` refuses when either face of the artifact already exists, not
  just the `.sqlite`.
  - Same review. A pre-existing `notes.md` was destroyed, exit 0, by a graph named
    `notes`.
- **DE-19.6** A flag given without a value errors rather than silently falling back to a
  default.
  - Same review. `--dir` with no value silently used the working directory, which is the
    one flag whose entire purpose is controlling where the User's artifact lands.
- **DE-19.7** The sidecar cannot be made to misrepresent the artifact: an entity name or
  value containing Markdown structure does not forge a heading or an attribute.
  - Same review. A value containing a newline and `- **status**: shipped` rendered as a
    real attribute in the inspectable face.
- **DE-19.8** `--pretty` produces a human-readable form distinct from the default JSON.
  - Same review. Accepted everywhere, named in every error's "It accepts:" list, and
    inert. IN-9 asserts this across every command later; this pins that it does anything
    at all.

Minted after the IN-9/10/11 sweep, by a second `/code-review` pass. These are
sub-numbered off the case whose claim they extend rather than off the slice in progress —
a deviation from the mint-by-slice rule, taken because an ID that says *where to look* is
worth more than one that says when it was found. Flagged for Ethan to ratify or reverse.

- **DE-7.1** `--dir` does not invent a directory tree, and says when it makes one.
  - `--dir ./no/such/dir` created all three levels at exit 0 with no warning. Also closes
    DE-7's own blind spot: a path that does not exist cannot be realpath'd, so where the
    temp root is a symlink (macOS) the guard did not fire.
- **DE-19.6.1** Every value-taking flag reaches the missing-value rule.
  - DE-19.6's sweep runs in an empty directory, where every row fails on something earlier
    — `no_graph_here`, `missing_option`, `not_implemented` — and never on
    `missing_value`. It passed against the pre-fix engine. This is the sweep it meant to
    be; DE-19.6 stays as it is.
- **DE-19.7.1** The pretty form cannot forge structure, and the namespace is not exempt.
  - DE-19.7 hardened the sidecar; DE-19.8 then added a second rendered face with no guard,
    so a value's newlines became payload lines. And `inline()` covered every
    interpolation except the namespace, which the validator permitted a control character
    in.
- **DE-19.8.1** A global flag is never mistaken for a command.
  - `cog-graphs --pretty` answered "'--pretty' is not a cog-graphs command" — while the
    overview's own output line advertises exactly that flag.
- **DE-19.8.2** The pretty form is unambiguous, not merely readable.
  - An empty object rendered as a dangling label, and array items had no delimiter, so an
    attribute-less item was indistinguishable from an item boundary.
- **IN-4.1** An unwritable sidecar does not break the command.
  - IN-4 put regeneration on the read path with an unguarded write, so a read-only sidecar
    killed `query` with an uncaught EPERM outside the exit alphabet — punishing the User
    who took the file's own "do not edit" banner seriously.

Minted while opening DE-20. Sub-numbered off DE-20 under both rules at once — they were
found there and they extend its claim — so they do not bear on the open numbering
question either way.

- **DE-20.1** A record that names no entity is rejected, not ingested under an empty name.
  - The bulk loop read `typeof item.entity === "string" ? item.entity : ""` and inserted
    the result. A record with no `entity:` key became a row named "" that no query can
    name and no modify-item can reach — and the second such record collided with the
    first, so the report blamed `entity_exists` on a name the Operator never wrote. A
    non-string entity (`entity: 2001`, a game YAML read as a number) gets its own code,
    `invalid_entity`, because the fix is quoting rather than naming.
- **DE-20.2** A record colliding with an earlier record in the *same file* is rejected on
  the same terms as one colliding with the artifact.
  - Reading the graph's names once and comparing against that snapshot is the obvious
    implementation and it is wrong: the snapshot does not know about the rows this same
    invocation just inserted. Green on arrival, so liveness was established by probe —
    deleting `taken.add(entity)` reds it. The probe also earned the case its exit-code
    assertion: without it, the duplicate reached SQLite, the UNIQUE constraint killed the
    process, and the artifact was left holding exactly the rows the case asked for. A
    count that is right because the program died before it could be wrong is not a claim.
- **DE-20.3** A source whose every record is rejected is still partial-with-report, with a
  count of zero; "total failure" means the import itself failed.
  - DE-20's sub-bullet asks for an exit distinct from total failure, which invites a
    fourth outcome for a batch where nothing landed. Rejected: the alphabet has no code
    for "nothing ingested", and inventing one gives an agent a branch for an outcome
    `ingested: 0` already states exactly. Total failure is read as a missing source
    (exit 2) or an unparseable one (exit 1) — already distinct, and distinct in kind,
    since nothing was offered and there is nothing to report per record. The case pins
    the reading so the next reader finds a decision rather than a silence.
- **IN-10.1** The interface sweep reaches the fourth class in the exit alphabet, and
  `import` has a success row at all.
  - Found opening DE-20. The sweep's own comment claims "at least one per class the exit
    alphabet names", and EXIT.PARTIAL was unreachable from its table — there was no code
    that could produce it before DE-20, and no row appeared when there was. `import` also
    had no success row: the one command whose answer can be neither success nor failure,
    and therefore the one most likely to grow private conventions, was swept only through
    its `--help`. Added as insertions to a frozen file (two rows, two expected-code
    entries, and a second `import` statement rather than an edit to the first, since an
    edited line is a removed line). Sub-numbered off IN-10 under the subject-based rule.
- **RU-5.1** The Assistant keeps what the User gives the graph in the way the User asked it
  to be kept, and changes an entry faithfully when the User asks it to. *(AI with rubric,
  over the kept-quotes scenario.)*
  - Its scenario is `testing/evals/eval_kept_quotes.ts` (`bun run eval:quotes`), whose
    gates settle the one thing a gate can: after the User asks for the name to be taken
    out, it is in no entity name, attribute, value, or `.md` face. The taste calls are the
    judge's, over the same run.
  - Recast 2026-09-11 by Ethan. The first wording, below, judged whether the Operator's
    storage choices kept the User's meaning; but what the Operator chooses cannot be a
    regression, and the question is "Did the Agent do what the User asked for?" The
    scenario, Ethan's: the User collects tidied quotations of their own from pasted
    snippets, one names a person, and they later ask for the name to be taken out.
  - First wording: what the User tells the Assistant about an item reaches the graph with
    its meaning intact, including what is new when they update it.
  - Found while drafting the rubric layer (2026-09-10) and minted by Ethan 2026-09-11.
    DE-23 guards fidelity at the CLI, where strings round-trip, and RU-5 asks whether the
    convention describes the stored data. Nothing asked whether the stored data
    describes what the User *said*. In the Walking Skeleton run of 2026-09-09T20-59, the
    fresh thread heard "I finally finished Portal 2" and "I gave up on Hades for good",
    decided nothing needed changing, and every gate passed. Grounded in the doc's
    source-fidelity and Just-in-Time Intelligence principles. Rubric text is in
    [Rubric layer](#rubric-layer). Sub-numbered off RU-5 (the data the Assistant stores)
    under the subject-based rule.
- **DE-5.1** A flag that takes a file documents that file in `--help` (under `files`), as a
  sample the command accepts verbatim: `initialize --profile` and `import --from`.
  - Found 2026-09-11 while ratifying the `items.yml` shape. The shape was sound, and it is
    exactly what `query` returns, but no surface showed it: not `import --help`, not the
    primer, not the overview. An agent could learn it only by guessing, and RU-6's flow
    runs through that file. It is asserted by round trip, so help cannot drift from the
    parser, and it requires every imported record to keep its attributes, because a flat
    sample ingests its entities cleanly and silently drops the data. Numbered by subject
    (DE-5 is the `--help` deliverable).

---

## Disputes

*Formerly `testing/DISPUTES.md`.*

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

### Entry format

```
### <CASE-ID> — <one-line claim>
- **Raised**: YYYY-MM-DD by <who>
- **The case says**: <quote or paraphrase>
- **The problem**: <why it cannot be satisfied, or what is ambiguous>
- **What I did instead**: <left as-is / partially satisfied — be specific>
- **Resolution**: <Ethan fills this in — amend the case, amend the doc, or reject the dispute>
```

### Open

_None._

### Resolved

#### Walking Skeleton turn 5: "modifying a couple items" passes with nothing modified
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
  as new information is a rubric question, raised as D8 in [Rubric layer](#rubric-layer).
- **Resolution**: 2026-09-11, Ethan. **Not a defect.** The Walking Skeleton's user turns
  were written while implementation requirements were looser, and they are low-signal
  material. Tightening earlier work is a normal part of the process: "sometimes you'll
  need to tighten up implementation from earlier." I read that as blessing a rewrite of
  the scenario's user turns. The eval file is frozen, so the rewrite will land citing this
  resolution. **Landed 2026-09-11**, as recommended: turn 3 now reads *"Portal 2, which I'm
  about halfway through and loving"*, and a check appended below DE-24 fails the run unless
  Portal 2's values differ between the checkpoints either side of turn 5. Turn 3's user
  line is the one line of `eval_walking_skeleton.ts` that changed.

#### IN-9/IN-10/IN-11 — the "unbuilt command" row named `import` in a literal
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

#### DE-19.3 — the unbuilt-command sweep cannot empty itself, and blocks DE-19
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

#### Stale reference — a frozen eval file names `DESIGN.md`, which no longer exists
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
#### Coverage gap — query's `--attr` / `--exclude` filters have no v0.3.1 case
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
  in `CLAUDE.md` (since moved to [The build loop](#the-build-loop)) and minted cases are listed in [Cases](#cases); future gaps go straight there
  rather than here. This file returns to what it is for — a landed case that looks
  *wrong*, which is still Ethan's to resolve.
#### RU-6 withdrawn — the behavior it grades is not ours to grade
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
- **The doc, which is the authority for scope**: struck by Ethan the same day. Block 60258 on
  `Cog-Graphs: Test Inventory, Walking Skeleton` now carries RU-6 in strikethrough rather than
  deleted, so the case stays legible as history — which is the right shape, since this entry
  and the commits point at it. Verified 2026-09-12. The doc and the repo agree.
- **Resolution**: 2026-09-12, Ethan — removal blessed, landed in the same commit as this
  entry; the doc struck by Ethan directly. Closed.

---

## Rubric layer

*Formerly `testing/rubrics/DRAFTS.md`.*

> **Status**: landed, 2026-09-12. Every RU case in scope is implemented and green:
> RU-1, RU-2, RU-4, RU-5 and RU-5.1 over the Walking Skeleton and kept-quotes, RU-3 at a
> true pass^3 (every trial judged, not just gated), and RU-7 over the error sweep on
> demand. **RU-6 was withdrawn** the same day — Ethan's scope call, blessed and timestamped
> in [Disputes](#disputes). This file is no longer a proposal; it is the record of how each
> rubric came to be worded the way it is, and the earlier drafting is left standing on
> purpose so the reasoning is legible. The claims are the design doc's (Technical
> Specification > Testing & Evaluation > RU). One thing is outstanding and Ethan's: the doc
> still lists RU-6.

### What these cases are for

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

### Shared design

#### What the judge sees

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

#### How a judge answers

- **One judge per rubric**, each in its own call.
- **Reasoning first, with quotes, then the verdict.** The verdict is `pass`, `fail` or
  `unknown`. `unknown` is for material that cannot support a verdict, such as a run that
  halted before the moment in question. It never counts as a pass, and it is reported
  separately.

  *As built (2026-09-11):* the judge reasons in its own thinking before it answers, and
  answers through the Agent SDK's structured output with four fields, `verdict`,
  `harness_issue`, `quotes` and `rationale`, in that order. `rationale` comes last on
  purpose: the long prose field is the one the judge often closes wrongly, and last, it
  has nothing after it to swallow. The judge does not always keep the order, and then the
  SDK's retry recovers the answer (see `testing/harness/HARNESS-IMPLEMENTATION.md`, "How an RU
  judge answers", for the counts). `harness_issue` is the judge's channel to us, per Ethan: null, unless
  the rubric or the material looks broken. An answer that never validates is an error,
  reported apart from every verdict.
- **Judge model `claude-sonnet-5`** (Ethan, 2026-09-11), the same model as the in-loop
  agent. The reference pairs are hand-written, so any lean a judge has towards its own
  model's style shows up there first, as a pair it gets wrong.
- **Scoring:** pass@1 for every case except RU-3, which is pass^3, as the doc specifies.
- **Offline, over stored artifacts.** A proposed `bun run eval:judge [artifact dir]`
  grades a run that has already happened. A rubric can then be iterated without paying for
  another agent run, and the frozen scenario files stay untouched.

#### Red first

Each rubric lands with a **pair of reference transcripts**, hand-written for the purpose:
one that plainly meets the claim and one that plainly breaks it. The judge has to get both
right. They are written by hand rather than lifted from past runs, because a reference
should show what the doc means, not what one agent did against an engine and a scenario
that are both still being tightened.

Ethan's labels on the pairs are the calibration set, and the pairs are JU-2's reference
solutions for this layer. A rubric and its pair are frozen once green.

---

### RU-1: the profile is established with the User

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

### RU-2: the cold thread orients itself

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

### RU-3: zero-priming fluency

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

### RU-4: the Assistant does not over-explain the mechanics

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

### RU-5: the seeded convention describes the data

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

### RU-6: one ingestion to confirm, then bulk — WITHDRAWN 2026-09-12

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

### RU-7: `next_step` is worth reading — LANDED 2026-09-12 (`bun run eval:errors`)

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

### RU-5.1 (minted 2026-09-11): the User's expectations are kept, and a change is made as asked

**Claim:** The Assistant keeps what the User gives the graph in the way the User asked it
to be kept, and changes an entry faithfully when the User asks it to.

**Intent** (Ethan, 2026-09-11): "This app should guide the Agent to use the expectations
set by the User, and to faithfully modify entries when requested." The profile holds "the
part that depends upon each use-case", and the convention carries it to every session.

**Recast the same day, and why.** The first draft asked whether what the User said about
an item survived into the graph, judged over the Walking Skeleton. Ethan's correction:
what the Operator chooses to put in a graph cannot be a regression. The regressions this
layer guards against are the implementation's, such as the program misleading the
Operator, or lossy handling of what it was given. The question is simply "Did the Agent
do what the User asked for?", and the scenario should make that question sharp rather than
leave it to nuance in a game's status.

**Material:** a dedicated scenario, **kept quotes** (Ethan's, 2026-09-11):
1. The User asks the Assistant to collect cleaned-up quotations of theirs, from snippets
   they paste, for later reference.
2. The User pastes a slightly malformed copy from a messaging app, in which they mention
   wanting to reach out to someone they name.
3. The Assistant saves a tidy version.
4. The User asks to see it.
5. The User asks for the name to be taken out. This is an improvised request in the
   User's words, not a command the CLI offers; `modify-item` is how it is done.

No fresh-thread check (Ethan). Engine check, 2026-09-11: `modify-item` overwrites the
value in place (the eav key is `(entity_id, attribute)`), and the old value is gone from
both the `.sqlite` bytes and the `.md`. An entity *name* holding the person's name can only
be changed by removing and re-adding the item, since there is no rename.

**Weigh:** did the Assistant keep to the expectations the User set, in what it kept and in
what form? When the User asked for a change, did the graph end up changed as they asked,
with nothing left in it that they wanted gone?

**Anti-pattern:** the User's expectations set aside, such as the raw paste stored or a
summary kept in place of their words; or a change that leaves behind what it was meant to
remove.

**ID:** numbered by subject off RU-5, the data the Assistant stores, under the numbering
rule Ethan settled on 2026-09-11 ([The build loop](#the-build-loop)).

---

### Seams, for confirmation before any test is written

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

**S2 landed 2026-09-11** (`testing/harness/judge.ts` `judgeRubric`, `testing/harness/rubric.ts`,
`bun run eval:judge`). The rubrics are in `rubrics.ts` and their reference pairs in
`references.ts`. Each reference is written by hand, but every command in it runs against the
real engine when it is built, so the tool results and the face a judge reads are the
engine's own. The labels are Claude's, awaiting Ethan's. `bun run eval:judge --references`
judges every labelled pair and fails unless each verdict matches its label.

### Proposed order

1. ~~**S1**, the judge view.~~ Done.
2. ~~**Reference pairs, then the judges for RU-1, RU-2, RU-4, RU-5 and RU-5.1** over them.~~
   Done; RU-5.1's pair is over the kept-quotes scenario rather than the Walking Skeleton.
3. ~~**Tighten the Walking Skeleton's user turns** (the resolved dispute in
   [Disputes](#disputes)) and re-run it.~~ Done 2026-09-11: every gate passed, turn 5
   changed Portal 2 ("About halfway through, loving it." → "Finished it — loved the whole
   thing."), 20 agent turns / 14 tool calls / $0.33. Judged: RU-1, RU-2, RU-4 and RU-5 all
   pass on it ($0.32).
4. ~~**RU-5.1's live scenario**, kept quotes, and a run judged against it.~~ Done
   2026-09-11 (`bun run eval:quotes`): 15 gates passed, including the name being gone from
   the graph and from the `.md` face, and RU-5.1 passes on the run ($0.20 + $0.06).
5. ~~**RU-3**: the zero-priming scenario, three trials.~~ Done 2026-09-11
   (`bun run eval:zero-priming`): pass^3, $0.23, and RU-3 passes on a trial as judged.
   The first attempt was 1/3, on a gate of mine rather than the claim — two agents added
   both plants and answered from `add-item`'s own output instead of running `query`. The
   claim is that the agent arrives, not which command it arrives by, so the gate went and
   the reason is in the scenario file.
   **Corrected 2026-09-12.** That "pass^3" was the *gates* three times over; the judge ran
   once, over one trial. pass^k is the probability that all k trials succeed, where a trial
   is one attempt graded by all of the task's graders, so judging one of three was not
   pass^3 of the case. `bun run eval:judge --scenario zero-priming --last 3` now judges every
   trial and passes only if all of them do: **3/3, $0.16**. Ethan's framing was the right one
   — "RU-3 is supposed to be like the other evals, grading the transcript".
   The dropped read-back gate is closed too, and more sharply than I had it: "if we're
   assessing Agents using query, the agents should be facing an unfamiliar graph, not one
   they've just constructed" (Ethan). An agent reading back a graph it built a moment ago is
   not being tested on retrieval at all — that claim lives in RU-2's cold thread.
6. ~~**RU-6**: the ingestion scenario.~~ Scenario done 2026-09-11
   (`bun run eval:ingestion`): every gate passes. **The rubric does not**: the judge failed
   the live run, because the assistant went straight from the pasted list to a twelve-item
   `import` and only showed its reading afterwards, when everything was already committed.
   That is the rubric doing its job — the implementation owes this one, and nothing in the
   eval layer should be softened to meet it.
   The first run also failed for a reason worth keeping: asked to put the list "somewhere I
   can actually search", the agent judged the sandbox to be a temporary workspace and made
   the graph under `~/cog-graphs/books-read` instead. The scenario now says "right here in
   this folder", because where the graph goes is DE-7's subject, not RU-6's.
   **Withdrawn 2026-09-12**, and everything above is now history rather than status. Ethan:
   the rubric grades implicit behavior — the agent's own restraint — where the program's job
   is to *guide* an agent about to bulk-import something unchecked. A real failure of the
   wrong subject is still the wrong subject. Removed in `d303682`, blessed and timestamped in
   [Disputes](#disputes), and recoverable whole from `f1803a8`.
7. ~~**RU-7**: the sweep landed; the rubric has not.~~ **Both landed 2026-09-12**:
   `ERROR_RUBRIC` in `rubrics.ts`, judged by `bun run eval:errors`, one call per code, run on
   demand rather than in any loop. **20/20 pass, $0.57.** The paragraph below stands as the
   question that was asked; the answer was that RU-7 simply is not the kind of case the pair
   rule governs, so it lives outside `RUBRICS` and the rule stays absolute where it applies.
   `testing/harness/error-sweep.ts` provokes
   every error code the engine can raise — 20 of them, each with its invocation, the whole
   error and that command's `--help` — and `testing/tests/error-sweep.test.ts` asserts the
   coverage for free, against the codes read out of the engine's own source, so a new code
   cannot ship ungraded. What is missing is the judging: every rubric here lands with a pair
   of reference *conversations*, and RU-7's material is one error on its own. See "Open for
   Ethan".

### Implementation follow-ups these drafts surfaced

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

- **Low priority: a multi-line convention reads as one line in the face** (surfaced by the
  reference views, 2026-09-11; Ethan: a low-priority follow-up). An Operator that seeds the
  convention as a YAML block (`convention: |`, as the 2026-09-09 live run did) gets one
  convention entry whose newlines `inline()` renders as a literal `\n`, in the `.md` face
  and in `introduce --pretty`. That is `inline()` doing its job (DE-19.7: it keeps a value
  from breaking the face's structure), so the fix is not there. Splitting a seeded block
  into one entry per line is one candidate, not a decision.

### Open for Ethan

- ~~**What a reference pair is, when the material is not a conversation** (RU-7).~~
  **Dissolved 2026-09-12** (Ethan): "I don't really see an issue to resolve, I'd say let's
  just create a procedure for automatically checking the existing error codes." The question
  assumed RU-7 had to join `RUBRICS` and therefore had to satisfy the pair rule. It does not.
  RU-7 is judged over one provoked error with no agent in it, so there is no conversation to
  pair; it is exported as `ERROR_RUBRIC`, outside `RUBRICS`, run on demand by
  `bun run eval:errors`, and the pair rule stays absolute for every case it actually governs.
  20/20 codes pass, $0.57, 2026-09-12.
- ~~**RU-6 fails on the live run.**~~ **Withdrawn 2026-09-12** (Ethan): "We're not really
  interested in evaluating *implicit* behavior … I'm not interested in evaluating this
  behavior." The rubric was grading the agent's restraint rather than the program's guidance.
  Blessed in [Disputes](#disputes); removed in `d303682`.

#### Still outstanding

- ~~**The design doc still lists RU-6**~~ — struck by Ethan, 2026-09-12, the same day. Block
  60258 keeps RU-6 in strikethrough rather than deleting it, so the case reads as history and
  the pointers in [Disputes](#disputes) and the commits still land somewhere. Doc and repo agree.
- **The instruction RU-6's withdrawal implies has not been filed.** Ethan's own words: "the
  solution would be to include instruction which tells the agent to be careful with bulk
  import, to ensure they understand". That is engine work on the primer or `import --help`,
  graded by DE-2/DE-5 rather than by a rubric, and it is a slice if you want it.
