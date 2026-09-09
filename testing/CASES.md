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
  - This is the one case whose whole claim is reliability, so pass^k. The other rubric cases stay at pass@1.
- **RU-4** The Assistant does not over-explain the mechanics to the User.
  - Anchored: the judge is shown the user turns and asked whether any assistant message would require the User to learn a system abstraction in order to follow it.
- **RU-5** The convention the Assistant seeds actually describes the data it is about to store: the attributes the convention names are the attributes it then uses.
- **RU-6** Given unstructured source material, the Assistant does one ingestion to confirm its understanding, then bulk-ingests the rest.
- **RU-7** The `next_step` carried by an error is actionable — it names a command or a concrete next move, not a restatement of the failure.
  - IN-11 asserts the field is present and non-empty; this asserts it is worth reading.

## JU — Ethan's judgement

- **JU-1** Ethan runs the Walking Skeleton manually end to end and records concerns.
- **JU-2** Every automated case has a reference solution: a known-good command transcript that passes all of its graders.
  - Proves the case is solvable and the graders are wired correctly, so a 0% pass rate is never misread as an incapable engine.

---

## Minted — holes found by the loop

Cases the doc does not list, covering behavior it already implies. Minted under the rule
in `CLAUDE.md` ("A hole in the cases is the next slice"), IDs sub-numbered off whichever
slice was in progress when the hole surfaced. These are frozen once green like any other
case, and are pending Ethan's ratification into the doc.

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
- **DE-19.3** A command that exists in the grammar but is not yet implemented fails with
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
