# Engine — Implementation Decisions

> **Status**: covers the v0.3.1 engine. Every probe below was re-run on 2026-09-12 against
> 333 tests; entries whose probe no longer went red were deleted that day. The engine was
> then split from one `main.ts` into modules (Polish phase), and each probe whose code moved
> was re-run against the split the same day.
> **Purpose**: the decisions `engine/` embodies, why each was taken, and what was
> rejected. The design doc owns *what* the engine must do. This file owns *how*, and —
> more usefully — *why not the other way*.

## How this file defends its own length

A long internal document decays predictably: nobody can tell which lines still mean
anything, so nobody deletes any, so it grows and goes stale. This file defends itself the
way the test suite does: **every claim carries the experiment that would prove it
worthless.** Each entry is:

1. **Argued** — why the decision was taken *and what was rejected*. A decision with no
   discarded alternative is a description of the code, and the code is already there.
2. **Cited** — a case ID, a symbol, a commit. **Never a line number**: a wrong one sends the
   reader to a real line that says something else.
3. **Falsifiable** — a **probe**: a specific change to the engine, and the specific case
   expected to go red. Run only the test file holding that case; it takes seconds.

**When a probe fails to go red, delete the entry** — do not soften it into something vaguer
that is technically still true. A probe marked ***reasoned*** has not been shown red and is
labelled so it can be discounted. Every count carries the date it was measured; a stale
number is the most persuasive kind of wrong claim, because it looks like evidence.

The bar for adding an entry: **a future engineer could plausibly undo it by accident.** Most
of what looks like tidying in the engine is load-bearing, which is why this file exists.
Commit messages carry the same reasoning at higher fidelity; this file exists because `git
log` cannot answer "everything we have decided about the sidecar." The v0.3.1 cases,
disputes and rulings are in `docs/3.1/dev-loop.md`.

---

## The one invariant everything else falls out of

**The `.sqlite` is authoritative. The `.md` is a view of it. Nothing is ever taken back from
the view.** When a new question comes up about the two faces, answer it from here first.

- **Escaping happens at render time, never at write time.** Escaping on the way in would
  corrupt the authoritative face to protect a derived one.
  *Cited:* DE-19.7; `inline()` in `render.ts`, called only from `renderSidecar` and
  `prettyLines`.
  *Probe:* wrap the value in `inline()` in `Graph.addEntity`'s INSERT — DE-23 goes red, and so
  do DE-19.7's "the database keeps the value exactly as it was given" cases.
- **A view that cannot be refreshed is a warning, never a failure.** The answer is still
  correct, and on a write the artifact has already committed.
  *Cited:* IN-4.1; the catch in `syncSidecar` returning `sidecar_unwritable`.
  *Probe:* rethrow from that catch — four of IN-4.1's five cases go red (2026-09-12, after the
  split).
- **The sidecar is synced once, after the command — readers and failures included.** A
  command names the graph it resolved (`Context.touch`) and `main.ts` syncs it, so a deleted
  or stale face comes back whatever command was run (IN-4), and an import that failed partway
  still leaves it current. Syncing from inside graph resolution *and* after each write, as
  before the split, reported an unwritable sidecar twice on a write.
  *Cited:* IN-4, IN-4.1; `main.ts`. ***Reasoned*** — the once-only half has no case: the
  differential run before and after the split is its only evidence.
- **Any face the engine renders needs the same guard.** Hardening the sidecar did not harden
  `--pretty`, because `--pretty` did not exist yet.
  *Cited:* DE-19.7.1; commit `6234f9c`. *Probe:* drop `inline()` from `prettyLines` —
  DE-19.7.1 goes red, DE-19.7 stays green.
- **`initialize` refuses when either face's filename is occupied.** A file at `notes.md` is
  not presumed to be ours; everything the artifact owns, it created.
  *Cited:* DE-19.5. *Probe:* check only the `.sqlite` — DE-19.5 goes red on the `.md` half.

---

## The shape of the engine

| Module | Holds | Never |
|---|---|---|
| `main.ts` | parse → gate → run → sync the sidecar → write once → exit once | — |
| `cli.ts` | `parse()` into an `Invocation`; the gate's ordered `STAGES`; `parseAttrs` | writes output |
| `commands.ts` | `COMMANDS`: `{ help, run }` per command, in overview order; `resolveGraph` | writes output, touches the sidecar |
| `graph.ts` | `SCHEMA` and every SQL statement (`Graph`, `withGraph`), the profile's shape, `select()`, where graphs live, `syncSidecar` | throws `CliError`, exits |
| `render.ts` | every face rendered from handed data: JSON, `--pretty`, the sidecar; `inline()` | reads a file or the database |
| `errors.ts` | `EXIT`, `ERRORS` (code → exit), `CliError`, `fail` | — |
| `docs.ts` | the primer, the system introduction, the file samples | — |

Commands return an answer or `fail()`, which throws; only `main.ts` touches stdout, stderr or
the exit code. The directory is also the Claude Code plugin root (`.claude-plugin/`, `bin/`,
`skills/`, `hooks/`); nothing in it has a dependency to install.

### The gate, and why its order is load-bearing

Every invocation passes `STAGES` in `cli.ts` in order; the first stage that answers or fails
ends it. **The order is itself several of the decisions below** — rearranging the array
changes behavior without touching a condition.

| # | Stage | Why it sits here |
|---|---|---|
| 1 | `frontDoor` | Bare `cog-graphs`, a line of only global flags, and `help` exit **0**. |
| 2 | `commandHelp` | Answers before validation, so a malformed invocation can still ask what it should have been. |
| 3 | `leadingFlag` | `unknown_option`, not `unknown_command`. |
| 4 | `unknownCommand` | Names every command that exists. |
| 5 | `unknownOption` | Rejected before anything runs. Deliberately does not echo the option. |
| 6 | **`danglingValue`** | **Syntax before semantics.** Uniform across the grammar. |
| 7 | `missingRequired` | Strictly after 6. |

Then `runCommand`: a command with no `run` answers `not_implemented`, distinct from stage 4.

*Probes (2026-09-12, after the split):* put `danglingValue` after `missingRequired` —
DE-19.6.1 goes red. Make `leadingFlag` never fire — DE-19.8.1 goes red. Move `commandHelp`
after `unknownOption` — **nothing goes red** across the five files that exercise the gate: no
case combines `--help` with a bad flag, so that placement is a decision with no case behind
it, recorded as a hole rather than described as protected.

**The exit alphabet** — `0 ok ; 1 usage ; 2 not found ; 3 already exists ; 4 partial
ingestion ; 5 ambiguous ; 6 internal` — is spelled out whole in `EXIT`, and IN-10 pins each
code to a named condition. A new command picks from this list; adding a code is a doc-level
change (DE-20.3 is the case of one being declined).

---

## Decisions

### Output and errors

**Every exit code in the alphabet is defined explicitly.**
A partial `EXIT` map is a silent success: a missing key reads `undefined`,
`process.exit(undefined)` exits **0** (EN1), and the command prints a good error while telling
the shell it succeeded. `bun run check` runs `tsc` for this reason: it names the defect at the
source, before any test runs.
Since the split, `ERRORS` in `errors.ts` names each code's exit once, typed against `EXIT`, so
a code no longer chooses its exit at the call site.
*Cited:* `EXIT`, `ERRORS`; EN1, EN2. *Probe:* delete `ALREADY_EXISTS` from `EXIT` — typecheck
fails, and 7 tests go red (DE-11, DE-19.5, IN-9, IN-10), 2026-09-12, after the split. The tests catch it only where
they assert that code; `tsc` catches it everywhere.

**Errors go to stderr, successes to stdout, never both.**
So an agent can pipe stdout into a parser without a failure corrupting the parse.
*Cited:* IN-9, which asserts the *quiet* stream is empty, not only that the loud one parses.
*Probe:* also write the error to stdout in `main.ts`'s catch — 22 IN-9 rows go red
(2026-09-12, after the split).

**Warnings ride in the payload, not on stderr.**
Otherwise a success must be read from two streams, and IN-9's "one object on one stream"
stops holding. A command puts its own in the answer; `main.ts` appends the sidecar sync's.
*Cited:* `main.ts`; DE-7, IN-4.1. *Probe:* write a warning to stderr before `main.ts` writes
the answer — 42 IN-9 rows go red (2026-09-12, after the split).

**`next_step` names something to do** — a command, a flag, or a file. It is the field that
makes an error worth having, and the first to decay into a restatement of the message.
*Cited:* IN-11; `fail()`. *Probe:* replace every `next_step` with "Something went wrong." —
**23 of 333 tests go red** (IN-11, DE-11, DE-15, DE-17, DE-22, DE-19.2), 2026-09-12, after
the split (done at render, in `main.ts`'s catch).

**Bare `cog-graphs` exits 0.**
Asking a tool what it is has not gone wrong; a zero-priming agent typing the binary name did
the most sensible thing available. Raised by `/code-review` as a probable bug and kept.
*Cited:* `frontDoor` in `cli.ts`. *Probe:* fail the front door with `usage` — 16 of 333 go
red, IN-10's `bare` and `--help` rows and DE-19.8.1 among them (2026-09-12, after the split).

**A leading `--flag` that isn't global is `unknown_option`, not `unknown_command`.**
Told "'--nonsense' is not a command", an agent starts guessing command names — the one move
that cannot help.
*Cited:* DE-19.8.1. *Probe:* see `leadingFlag` above.

**`not_implemented` is distinct from `unknown_command`, and an unbuilt command is an entry
with no `run`.**
"You mistyped" and "there is nothing behind this yet" imply different next moves; an agent
that cannot tell them apart retries with a different spelling forever. Every case that cares
derives the unbuilt set from `--help`, so the apparatus sits idle while every command is
built — and is kept, because the next unbuilt command needs it. Before the split, "unbuilt"
was a separate `UNBUILT` set beside the command bodies, so help could call a command unbuilt
while its body still ran; with `run` absent being the only spelling, the two cannot disagree.
*Cited:* DE-19.3, DE-21, IN-10; `runCommand`. *Probe:* remove `convention`'s `run` — the suite
grows from 333 to 338 as derived rows revive, and only DE-21's 7 cases go red: DE-19.3,
IN-10's unbuilt row and S4 pass, because the command really is unbuilt and says so (EN8).
Do that *and* answer with `unknown_command` — DE-19.3, IN-10's unbuilt row and S4 go red too.
Both 2026-09-12, after the split.

### Argument parsing

**A flag written without a value is an error, never a default.**
`--dir` with nothing after it once silently used the working directory — the one flag whose
purpose is controlling where the User's artifact lands, doing the opposite at exit 0. If a
value did not survive whatever produced the command line, a guess cannot be right, because
it is invisible.
*Cited:* DE-19.6; `danglingValue`, and `valueAfter()` behind `Invocation.value` and `values`.
*Probe:* two layers guard this, so break both — make `value()` return `undefined` on a
dangling flag *and* drop `danglingValue` from `STAGES`: both DE-19.6 cases, DE-19.6.1 and
IN-10's flag-without-a-value row go red. Either layer alone holds (2026-09-12, after the
split).

**Syntax before semantics: a dangling flag outranks a missing required flag.**
`import --graph` is wrong twice — no value *and* no `--from`. The dangling flag names a token
actually present and says what is wrong with it; it is also the likelier real defect, since a
value lost to shell quoting leaves exactly that shape. The check is uniform across the
grammar, because deciding it per command is how a rule goes selectively true.
*Cited:* DE-19.6.1. *Probe:* see the gate above.

**The command is the first token that is not a global flag.**
Reading `argv[0]` answered `cog-graphs --pretty` — advertised in the overview's own output —
with "'--pretty' is not a cog-graphs command".
*Cited:* DE-19.8.1; `commandIndex` in `parse()`. *Probe:* take the command from `argv[0]` — five of
DE-19.8.1's six cases go red (2026-09-12, after the split).

**`--attr key=value` splits on the *first* `=` only.**
Splitting on every `=` refuses ordinary values: a URL with a query string, a formula. The
engine does not get to narrow what a value may contain.
*Cited:* DE-23; `parseAttrs()`. *Probe:* reject any pair with more than one `=` — DE-23 goes red.

**`modify-item` sets the named attributes and leaves the rest alone.**
Delete-then-insert is indistinguishable from correct on a single-attribute item and silently
erases everything else on any other — exactly the accumulated knowledge the graph exists to
hold.
*Cited:* DE-13; the `ON CONFLICT` upsert in `Graph.setAttributes`. *Probe:* delete the entity's rows before the upsert
— DE-13 goes red, because it uses a multi-attribute entity (2026-09-12, after the split).

### Bulk ingestion

**The items file mirrors `add-item` in data form.**
An entity and its attribute map, so an agent that has read `add-item --help` can write one
without a second lesson. It is also exactly the shape `query` returns, so a query's output
imports as it is. The doc never says what is in the file; Ethan ratified this shape on
2026-09-11. `import --help` and the primer take their sample from one constant.
*Cited:* DE-19, DE-5.1; `ITEMS_SAMPLE`. *Probe:* write the first record flat (`status: open`
beside `entity`) — DE-5.1's import case goes red, its initialize case stays green.

**A partial ingestion reports as a structured error on stderr, not as a success payload.**
IN-9 gives the whole surface one rule — a non-zero exit puts one object on stderr — so the
report *is* the error object (`CliError`'s `detail` carries `ingested` and `rejected`), rather
than the surface growing an exception for its one half-right command.
*Cited:* DE-20, IN-9, IN-11. *Probe:* return the report as the answer instead of failing —
IN-10's partial row and every DE-20 / DE-20.x reporting case go red — 10 across the three files
(2026-09-12, after the split).

**What a bulk record must be is taken from `add-item`, never invented.**
A known entity is `entity_exists`, a nameless record `missing_value` — `add-item`'s codes. The
rule is not "be strict" but "be identical": a bulk path stricter *or* laxer forces an Operator
to learn which one it is talking to.
*Cited:* DE-20, DE-20.1. *Probe:* accept a colliding record as an update — DE-20's "the
offender changed nothing" goes red.

**A record with no entity reports `entity: null`; a non-string entity gets `invalid_entity`.**
An empty string is indistinguishable from a genuine empty name. `entity: 2001` is a game YAML
read as a number; the fix is quoting, a different act from naming. Coercing it silently would
put a value this program invented into the Operator's data.
*Cited:* DE-20.1. *Probe:* replace both rejections with `typeof named === "string" ? named : ""` — all
four DE-20.1 cases go red, and DE-20.3 (2026-09-12).

**The taken-names set grows as records land.**
A snapshot read once lets a file's second mention of an entity through to SQLite, where the
UNIQUE constraint kills the process mid-batch — total collapse on one bad record.
*Cited:* DE-20.2. *Probe:* delete `taken.add(named)` — both DE-20.2 cases go red (2026-09-12,
after the split). One only
did until the other gained an exit-code assertion: a count that is right because the program
died before it could be wrong is not a claim.

**Nothing-ingested is still partial; "total failure" means the import itself failed.**
The alphabet has no code for "nothing landed", and `ingested: 0` already states it. A missing
source (2) and an unparseable one (1) are the total failures.
*Cited:* DE-20.3. *Probe:* give the all-rejected batch its own exit code — DE-20.3 goes red.

### The convention

**Amending the convention appends; it never overwrites.**
An Operator who learns in week three that ratings run 1-10 is recording something that
*became* true, and the earlier expectation is how the items already stored are to be read.
*Cited:* DE-21; the `convention` table's `seq`. *Probe:* delete the last row before appending
— DE-21's ordering, sidecar and `introduce` read-back cases go red.

**The amend answers with the whole convention.**
An agent that amends needs what the graph now says about itself before its next write, and
should not need a second call to learn it. (An earlier version of this entry also claimed the
sidecar was rewritten only on an amend. It was not true then — graph resolution synced it on
every command — and the sync is now uniform by design; see the first section.)
*Cited:* DE-21. *Probe:* answer `{ appended }` — DE-21's "answers with the whole convention"
goes red.

### The inspectable face

**`inline()` collapses CR/LF/CRLF to a visible `\n` and touches nothing else.**
Backslashes are deliberately *not* escaped: `C:\games` is an ordinary value and doubling it
would make every sidecar pay for the rare case. The tradeoff: a value containing the literal
characters `\n` renders like one containing a newline — ambiguous, but structurally harmless.
*Cited:* DE-19.7; `inline()`. *Probe:* also escape backslashes — DE-19.7's "ordinary values are
untouched" goes red (2026-09-12; this was unpinned when first written).

**A control character in a namespace is rejected, not escaped.**
A namespace is a filename and an identifier the Operator types back, so a control character in
one is never legitimate content. An attribute value is the User's own data, and refusing it
would be the engine putting words in their mouth. Escape data; reject identifiers.
*Cited:* DE-19.4, DE-19.7.1; `isValidNamespace()`. *Probe:* drop the control-character test —
DE-19.7.1's newline, carriage-return and tab cases go red. *Probe:* apply the same test to
attribute values — DE-23 goes red, which is the asymmetry being asserted.

### `--pretty`

**Depth 0 reflows; everything deeper is inlined.**
The top-level fields are text the engine wrote — the primer, the introduction — and reflowing
them is why `--pretty` exists. Everything nested is text it was handed; reflowing *that* lets a
value of `count: 999` render as a field the payload does not have.
*Cited:* DE-19.7.1; `prettyLines()`. *Probe:* reflow at every depth — DE-19.7.1 goes red.

**Emptiness is rendered, not omitted.**
A bare label with nothing under it cannot be told apart from a renderer that stopped. Array
items carry a bullet so the boundary between two is countable.
*Cited:* DE-19.8.2. *Probe:* omit empty objects instead of printing `label: (none)` —
DE-19.8.2 goes red.

**The renderer walks the payload generically**, so a command added later is readable without
anyone teaching it. *Observed, not probed:* `import` (DE-19) and `convention` (DE-21) landed
with no `--pretty` work and IN-9's `--pretty` rows covered both on arrival.

### The filesystem

**No WAL.** It leaves `-wal`/`-shm` beside the database, and a graph copied without them has
lost its latest writes. One short-lived process per command needs no concurrency. Revisit only
with concurrent Operators — and revisit IN-6 *with* it.
*Cited:* IN-6. *Probe:* `PRAGMA journal_mode = WAL` after creating the database — both IN-6
cases go red.

**`--dir` creates one level and says so; two is refused.**
`--dir ./graphs` is "make me a folder for this"; `--dir ./Documnets/graphs` is a typo, and
creating it lands the graph somewhere nobody will open, reported as success. The parent is
exactly where the two stop looking alike.
*Cited:* DE-7.1; the `directory_not_found` check. *Probe:* remove the parent check and create
recursively — DE-7.1's two-level refusal and its "nothing left behind" go red.

**Temp-root detection asks about the nearest *existing* ancestor.**
A path that does not exist cannot be `realpath`'d, so where the temp root is a symlink (macOS)
the guard compared an unresolved path against a resolved one and did not fire.
*Cited:* DE-7.1; `nearestExisting()`. *Probe:* ***reasoned.*** Bypassing it turns nothing red on
Windows (2026-09-12), where the symlink shape does not exist; a macOS run settles it.

**The guard stays quiet in an ordinary directory.**
A warning that fires everywhere is scrolled past, and then the real one is invisible too. The
paid layer confirmed the cost of the real one: an agent reads it and stops to ask the User
where the graph belongs (`testing/harness/HARNESS-IMPLEMENTATION.md`, "Where the sandbox
lives").
*Cited:* DE-7, deliberately two-directional; DE-7.1. *Probe:* raise `temp_directory`
unconditionally — DE-7's "stays quiet in an ordinary directory" goes red. Raise
`created_directory` unconditionally — DE-7.1's "an existing directory is used without comment"
goes red.

---

## Failure patterns that keep recurring

Claims about future mistakes rather than current code, so most have no probe; the evidence is
recurrence.

**Silent success.** The command does the wrong thing and reports 0: `process.exit(undefined)`;
`--dir` with no value; `--dir` inventing a tree; a namespace of `../escaped` writing outside the
target; `initialize` destroying a pre-existing `notes.md`. A *reasonable* input produces a
*plausible* result, and the artifact is well-formed — just the wrong artifact. When adding a
code path, ask what it does with input that is wrong but not malformed.
*Cited:* DE-19.4, DE-19.5, DE-19.6, DE-7.1.

**One face hardened, another added.** DE-19.7 escaped the sidecar; DE-19.8 then added `--pretty`
unguarded and the same forgery worked again. *Cited:* commits `2558210`, `3c9fd5b`, `6234f9c`.

**The likelier error fires first.** A sweep that runs every flag in an empty directory fails
every row on `no_graph_here` or `missing_option` — never on the rule under test — and passes
against a broken engine. Give each row enough context to reach the code under test, and assert
the error code **by name**. *Cited:* DE-19.6.1; recurred in DE-19.

**Green on arrival is not evidence.** Break the behavior, watch the case fail, revert, record the
probe in the commit. Twice a probe disproved a case's own rationale (IN-7, DE-19.7), and a weak
probe is itself a finding — DE-20.2 and DE-21 each gained an assertion from one. The 2026-09-12
pass is the same lesson at file scale: three entries here had outlived their probes.

**Non-idempotent commands cannot be run twice and diffed.** `initialize`, `add-item` and
`remove-item` answer differently the second time because they worked. *Cited:* four false reds
in the IN-9 sweep; commit `b9a37c9`.

**A snapshot baseline must include what setup wrote**, or it asserts that the fixture was
written. *Cited:* IN-6; commit `a4edde6`.

---

## Empirical claims

Observed on this machine, free to re-check. IDs are stable; retired rows leave gaps.

| ID | Claim | Why it matters | Verification |
|---|---|---|---|
| **EN1** | `process.exit(undefined)` exits **0**. | Why typecheck is in the gate. | `bun -e 'process.exit(undefined)'; echo $?` — printed `0` on bun 1.3.14, 2026-09-12. |
| **EN2** | `tsc` catches an undefined `EXIT` member at the source; `bun test` catches it only where a test asserts that code. | The gate, not the suite, is what makes a partial map impossible. | Delete a key from `EXIT`, run `bun run typecheck` then the files asserting that code. `ALREADY_EXISTS`: typecheck fails, 6 red (2026-09-12). |
| **EN4** | Creating a `.sqlite` costs ~700 ms on the E: drive (a spinning SMR hard disk) and ~10 ms on the C: NVMe SSD — in a temp directory or not. A CLI call costs ~66 ms, 49 of them bun startup. | The full suite's ~75 s is process count, not the disk: ~5 s per file-scoped probe, either drive. The `--timeout 20000` was set when DE-7's ordinary-directory sandboxes sat on the hard disk. Corrects an earlier reading that blamed antivirus. | Time `new Database(path, { create: true })` in each location; time `bun engine/main.ts --help`. Measured 2026-09-12, median of 6–7. |
| **EN5** | A read-only sidecar that is *stale* makes an unguarded `syncSidecar` throw `EPERM`; a *current* one does not. | Anyone re-testing IN-4.1 must make the content differ, or conclude it was never broken. | Edit the `.md`, `chmod 0o444` it, run `query`. |
| **EN6** | `Bun.YAML.parse` reads both the profile and items formats with no dependency. | The repo adds no external deps. | DE-6, DE-19 and DE-23 round-trip through it. |
| **EN7** | On POSIX a filename containing a newline is creatable. | Why the namespace validator rejects control characters rather than trusting the filesystem. | ***Reasoned*** — not reproducible on Windows; a POSIX run settles it. |
| **EN8** | With every command built, removing one command's `run` grows the suite from 333 to 338 tests and reds only that command's own cases. | The revived rows prove the sweep is derived from the CLI; that DE-19.3, IN-10 and S4 stay green proves the unbuilt path works end to end. | Rename `convention`'s `run` in `commands.ts`, run `bun test`: 338 tests, DE-21's 7 red. 2026-09-12, after the split. |
