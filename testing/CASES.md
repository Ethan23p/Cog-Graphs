# v0.3.1 test cases — local extract

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

## Slice order

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

## IN — artifact invariants

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

## IN — interface invariants

- **IN-9** Every invocation's default output parses as JSON; `--pretty` produces the human-readable form.
- **IN-10** Exit codes are meaningful on every invocation — 0 on success, non-zero on failure, distinct codes for distinct failure classes.
- **IN-11** Every non-zero exit emits a structured error object with non-empty `code`, `message`, and `next_step` fields, on a documented stream.

## DE — code / deterministic

### Introduction & initialization

- **DE-1** `introduce` with no instance present returns the *system* introduction — how to use the system — rather than erroring.
- **DE-2** `introduce --interface-skill` returns non-empty primer content at exit 0, and the primer names every command the Walking Skeleton requires.
- **DE-3** `--managed` appears in no user-facing output: not in any command's `--help`, not in any success output, not in any error output.
- **DE-4** `--managed` supplied on input is rejected: non-zero exit, unrecognized-option error. It never silently succeeds.
- **DE-5** Every command answers `--help` at exit 0 with output that names its required flags and carries at least one runnable example.
- **DE-6** The profile stored in the artifact matches the imported `.yml` field for field.
- **DE-7** Temp-directory guard, both directions: `initialize` targeting a path under the platform temp root emits an explicit warning naming the risk; `initialize` in an ordinary directory emits no such warning.
  - The warning travels as a `warnings` array in the JSON output, so it does not break IN-9.

### Query & single-item operations

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

### Bulk ingestion

- **DE-19** Bulk ingestion of N items in one invocation yields exactly N items; a subsequent query returns all N with attribute/value pairs intact; the sidecar enumerates all N.
- **DE-20** A bulk ingestion containing one invalid record behaves as partial-with-report: the valid records are committed, the invalid record is rejected, and the report names the offender by identifier and by position.
  - The exit code for a partial ingestion is distinct from both clean success and total failure, per IN-10.
  - `--help` for the bulk command states the partial-with-report semantic explicitly, so an Operator is never guessing whether a batch was atomic.

### Convention

- **DE-21** The convention is amendable: after an amend, a read-back returns the amended convention and the sidecar reflects it.

### Graph targeting

- **DE-22** With two instances in the same working directory, omitting `--graph` errors legibly and names the candidates rather than silently choosing one; `--graph` naming a non-existent instance errors and names what does exist, or points at `initialize`.

### Fidelity & ergonomics

- **DE-23** Source-fidelity round-trip: an entity name and attribute values containing spaces, an apostrophe, a non-ASCII character, an `=`, and an internal newline survive add → query → sidecar unchanged.
- **DE-24** Ergonomics budget: the Walking Skeleton completes within declared ceilings on agent turns, tool calls, and total tokens.
  - The harness already records all three. Starts as a generous ceiling and tightens as the numbers stabilize; it is the only guard on the stated priority of token efficiency.

## RU — AI with rubric (eval harness; costs money)

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
  is implicit behavior and not what this suite grades. Blessed in `testing/DISPUTES.md`; the
  rubric, its pair and the ingestion scenario are in the history at f1803a8. Struck in the
  design doc the same day (block 60258, kept in strikethrough), so doc and repo agree.
- **RU-7** The `next_step` carried by an error is actionable — it names a command or a concrete next move, not a restatement of the failure.
  - IN-11 asserts the field is present and non-empty; this asserts it is worth reading.
  - Judged over the error sweep by `bun run eval:errors`, one call per code, **manually
    invoked** after a change to the engine's errors rather than in any loop (Ethan,
    2026-09-12). 20/20 pass, $0.57, 2026-09-12. `ERROR_RUBRIC` sits outside `RUBRICS` on
    purpose: its material is one error, not a conversation, so the reference-pair rule that
    governs every conversational rubric does not apply to it.

## JU — Ethan's judgement

- **JU-1** Ethan runs the Walking Skeleton manually end to end and records concerns.
- **JU-2** Every automated case has a reference solution: a known-good command transcript that passes all of its graders.
  - Proves the case is solvable and the graders are wired correctly, so a 0% pass rate is never misread as an incapable engine.

---

## Minted — holes found by the loop

Cases the doc does not list, covering behavior it already implies. Minted under the rule
in `CLAUDE.md` ("A hole in the cases is the next slice"). IDs are sub-numbered by subject
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
  CLI rather than a literal, so it retires itself as commands land; see DISPUTES.md)* A
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
    `testing/rubrics/DRAFTS.md`. Sub-numbered off RU-5 (the data the Assistant stores)
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
