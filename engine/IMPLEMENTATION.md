# Engine — Implementation Decisions

> **Status**: opened 2026-09-09, covering the v0.3.1 build loop through DE-19.
> **Purpose**: the decisions `engine/main.ts` embodies, why each was taken, and what was
> rejected. The design doc owns *what* the engine must do. This file owns *how*, and —
> more usefully — *why not the other way*.

## How to read this file, and how it defends its own length

A long internal document decays in a predictable way: nobody can tell which lines still
mean anything, so nobody deletes any of them, so it grows, so fewer people read it, so
more of it goes stale. The usual defenses — a review cadence, an owner, a "last updated"
stamp — all depend on somebody remembering. This file defends itself instead, the same
way the test suite does: **every claim in it carries the experiment that would prove it
worthless.**

The standard, which every line here is held to:

1. **Argued.** The line says why the decision was taken *and what was rejected*. A
   decision with no discarded alternative is not a decision, it is a description of the
   code, and the code is already there.
2. **Cited.** The line points at something checkable: a case ID, a file and symbol, a
   commit. "We do X because Y" with nothing to open is an assertion.
3. **Falsifiable.** The line names a **probe** — a specific change to make, and the
   specific case expected to go red. If the probe is run and nothing goes red, the claim
   is not load-bearing, and the line comes out.

**This is a validation procedure, not a style guide.** A fresh instance with no memory of
this project can pick any entry below, run its probe, and learn in one command whether
the entry earns its space. Nothing here asks to be taken on trust, so nothing here needs
an author to vouch for it.

**When a probe fails to go red, delete the entry.** Do not soften it, do not add a
caveat, do not reword it into something vaguer that is technically still true. A claim
that survives by becoming unfalsifiable is worse than a deleted one, because it still
costs a reader their attention and now teaches them nothing. The file getting shorter is
the mechanism working.

**Citations name a symbol, not a line number.** Line numbers have gone stale twice in two
sessions — every slice that touches `main.ts` moves them, and a wrong line number is worse
than none because it sends a reader to a real line that says something else. A symbol name is
one `grep` and it survives the file being rearranged. Corrected wholesale at DE-21 after five
of eighteen citations had drifted; verified by script rather than by eye, since eye is how
they drifted.

**A probe marked *reasoned* is a claim that has not been run.** Those are the weak lines
by construction and are labelled so a reader can discount them without having to guess
which ones they are. Turning one into a real probe is always an improvement; so is
deleting it.

The bar for adding an entry: **a future engineer could plausibly undo it by accident.** A
decision whose reversal would be obviously wrong does not need writing down. One that
looks like tidying does — and most of what looks like tidying in `main.ts` is
load-bearing, which is the entire reason this file exists.

## What belongs here, and what does not

| File | Owns |
|---|---|
| `Cog-Graphs` page in Logseq | The spec. Scope, entities, capabilities, roadmap, cases. Authoritative. |
| `testing/CASES.md` | Every case there is, in slice order, plus minted ones. Navigation. |
| `testing/DISPUTES.md` | A landed case that looks *wrong*. Ethan resolves. |
| `testing/harness/IMPLEMENTATION.md` | The eval runtime and its SDK claims. |
| **this file** | Engine decisions, the reasoning that produced them, and the failure patterns that keep recurring. |

Commit messages carry the same reasoning at higher fidelity and are the primary record —
`git log --oneline` plus `git show` on any case ID gets the full argument. This file
exists because that record is unsearchable *across* decisions: `git log` can find why
DE-19.7 happened, but not "everything we have decided about the sidecar."

---

## The one invariant everything else falls out of

**The `.sqlite` is authoritative. The `.md` is a view of it. Nothing is ever taken back
from the view.**

Half the decisions below are this rule applied to a new situation. When a new question
comes up about the two faces, answer it from here before inventing anything.

Consequences, each a separate slice before the pattern was obvious:

- **Escaping happens at render time, never at write time.** The database keeps exactly
  what it was given; the rendering is what has to be honest about it. Escaping on the way
  in would corrupt the authoritative face to protect a derived one.
  *Cited:* DE-19.7; `inline()` at `engine/main.ts`, called only from `renderSidecar`
  and `prettyLines`. *Probe:* move the `inline()` call into the `add-item` INSERT path —
  DE-23 goes red on source fidelity while DE-19.7 stays green, which is the shape of the
  mistake.
- **A view that cannot be refreshed is a warning, never a failure.** The answer is still
  correct, and on a write the artifact has already committed — failing there would report
  a loss that did not happen.
  *Cited:* IN-4.1; the try/catch around `writeSidecar` pushing `sidecar_unwritable`.
  *Probe:* let the `writeSidecar` exception propagate — IN-4.1 goes red.
- **Any face the engine renders needs the same guard.** Hardening the sidecar did not
  harden `--pretty`, because `--pretty` did not exist yet. The guard belongs to the class
  of rendered output, not to the renderer that existed when it was written.
  *Cited:* DE-19.7.1; commit `6234f9c`. *Probe:* drop `inline()` from `prettyLines` —
  DE-19.7.1 goes red, DE-19.7 stays green.
- **`initialize` refuses when either face's filename is occupied.** A file at `notes.md`
  is not presumed to be ours. Everything the artifact owns, it created.
  *Cited:* DE-19.5; commit `2f03085`. *Probe:* check only the `.sqlite` — DE-19.5 goes
  red on the `.md` half.

---

## Decisions

### Output and errors

**Every non-zero exit code in the alphabet is defined explicitly.**
A partial `EXIT` map is not a partial feature, it is a silent success: `EXIT.ALREADY_EXISTS`
reads `undefined`, `process.exit(undefined)` exits **0**, and the command prints a perfectly
good error on stderr while telling the shell it succeeded. Every case asserting an exit code
passes against that. This shipped, briefly, and was found by `tsc` — which had been flagging
six call sites the whole time. `bun run check` exists because of it.
*Cited:* `EXIT` at `engine/main.ts`; claim EN1/EN2 below. *Probe:* delete one key from
`EXIT` — `bun run typecheck` fails immediately and `bun test` stays green, which is the whole
argument for the gate.

**Errors go to stderr, successes to stdout, never both.**
So an agent can pipe stdout into a parser without a failure corrupting the parse. A command
writing to both has broken the contract even when each stream is individually well-formed.
*Cited:* IN-9, which asserts the *quiet* stream is empty rather than only that the loud one
parses. *Probe:* echo the error payload to stdout as well as stderr — IN-9 goes red; a test
that only checked "stderr parses" would not.

**Warnings ride in the payload, not on stderr.**
Otherwise a success becomes something the Operator must parse two streams to understand, and
IN-9's "one JSON object on one stream" stops holding. `runtimeWarnings` collects warnings
raised by machinery rather than by the command; `succeed()` merges them in, preserving the
`warnings` key when a command supplied one *even if empty*, because DE-7 reads it either way.
*Cited:* `succeed()` at `engine/main.ts`; DE-7, IN-4.1. *Probe:* write a warning to
stderr on a successful command — IN-9 goes red. *Probe:* drop the empty-array preservation —
DE-7 goes red on the absent key.

**`next_step` names something to do.**
A command, a flag, or a file. It is the field that makes an error worth having, and the first
one to decay into a restatement of the message.
*Cited:* IN-11; `fail()` at `engine/main.ts`. *Probe:* replace every `next_step` with
"Something went wrong." — **23 cases go red**, run 2026-09-09 against 278 tests. The count
is what makes this a real constraint rather than a preference.

> This entry is the file's own procedure catching itself. The count read 12 when this
> section was written, was re-run under the policy, and was wrong — the suite had grown
> underneath it. A stale number is the most persuasive kind of wrong claim, because it
> looks like evidence. Every count in this file therefore carries the date it was
> measured; a count without one has not been checked and should be treated as absent.

**Bare `cog-graphs` exits 0.**
Asking a tool what it is has not gone wrong. A zero-priming agent typing the binary name did
the most sensible thing available; answering with a failure code teaches it otherwise. Raised
by `/code-review` as a probable bug and kept deliberately.
*Cited:* IN-10's table, which pins it with the reasoning inline; `overview()` at
`engine/main.ts`. *Probe:* return `EXIT.USAGE` from the front door — IN-10's `bare` row
goes red. That the case had to be *argued* rather than fixed is why this entry exists.

**A leading `--flag` that isn't global is `unknown_option`, not `unknown_command`.**
Told "'--nonsense' is not a command", an agent starts guessing command names — the one move
that cannot help. The distinction tells it to look at flags instead.
*Cited:* DE-19.8.1; commit `399b4ba`. *Probe:* route unknown leading flags to
`unknown_command` — DE-19.8.1 goes red.

**`not_implemented` is distinct from `unknown_command`.**
"You mistyped" and "you read the help correctly and there is nothing behind it yet" imply
different next moves. An agent that cannot tell them apart retries with a different spelling
forever. The set of unbuilt commands is one `Set` in the engine, and every case that cares
derives its list from `--help` rather than naming commands, so the whole apparatus retires
itself when the set empties.

**`UNBUILT` is empty as of DE-21 (2026-09-09), and the apparatus has retired on schedule.**
The set and its machinery are kept rather than deleted: they are what the next unbuilt
command will need, and the retirement is only meaningful while the mechanism that would
un-retire it still works. The probe therefore runs in the other direction now, and it is a
better probe than the original — it shows the sweep is live rather than merely absent.
*Cited:* DE-19.3 (amended 2026-09-09, see `testing/DISPUTES.md`), DE-19.6.1, DE-21,
IN-9/10/11; `UNBUILT` at `engine/main.ts`. *Probe:* put a **built** command back into
`UNBUILT` (`new Set(["convention"])`) — the suite grows from 302 tests to 307 as the derived
rows come back, and **3 go red**: DE-21's "no command reports itself unbuilt any more",
DE-19.3's "convention fails loudly rather than silently", and IN-10's "unbuilt command"
row. Run 2026-09-09. Two properties in one command: the sweep revives from the CLI rather
than from a literal, and a `UNBUILT` entry that is not true is caught rather than believed.

### Argument parsing

**A flag written without a value is an error, never a default.**
`--dir` with nothing after it silently used the working directory: the one flag whose entire
purpose is controlling where the User's artifact lands, doing the opposite of what was asked,
at exit 0. An Operator who writes a flag has stated an intention; if the value did not survive
whatever produced the command line, a guess is the one response that cannot be right, because
the guess is invisible.
*Cited:* DE-19.6; `valueAfter()` at `engine/main.ts` — the single choke point, with
`optionValue` and `optionValues` both routing through it. *Probe:* have `optionValue` return
`undefined` instead of failing — DE-19.6 goes red.

**Syntax before semantics: a dangling flag outranks a missing required flag.**
`import --graph` is wrong twice — `--graph` has no value *and* `--from` is absent — so the
only question is which diagnosis an Operator can act on. The dangling flag names a token
actually present in the command line and says what is wrong with it; "import requires --from"
ignores the broken thing just written. It is also the likelier real defect, because a value
lost to shell quoting or a template substitution leaves exactly that shape behind. Deciding
this per command is how the rule goes selectively true, so the check is uniform across the
grammar.
*Cited:* DE-19.6.1; the `documented`/`valueless` pass in `engine/main.ts`, ahead of the required-flag check.
*Probe:* move the pass below the required-flag check — DE-19.6.1 goes red on
`import --graph`. Landed 2026-09-09 as part of DE-19; before it, that invocation answered
`missing_option`.

**The command is the first token that is not a global flag.**
`--pretty query` and `query --pretty` are the same request. Reading `argv[0]` meant
`cog-graphs --pretty` — advertised verbatim in the overview's own output — was answered
"'--pretty' is not a cog-graphs command".
*Cited:* DE-19.8.1; the `commandIndex` derivation at `engine/main.ts`. *Probe:*
restore `argv[0]` — DE-19.8.1 goes red.

**`--attr key=value` splits on the *first* `=` only.**
Splitting on every `=` and rejecting the rest refuses ordinary values: a URL with a query
string, a formula. Source fidelity is the doc's default assumption, so the engine does not
get to narrow what a value may contain.
*Cited:* DE-23; `parseAttrs()` at `engine/main.ts`. *Probe:* split on every `=` and
reject more than two parts — DE-23 goes red.

**`modify-item` sets the named attributes and leaves the rest alone.**
The tempting shortcut — delete the entity's rows, write the given pairs as the whole record —
is indistinguishable from correct on a single-attribute item and silently erases everything
else on any other. Since the Operator names only what changed, that shortcut destroys exactly
the accumulated knowledge the graph exists to hold.
*Cited:* DE-14/DE-15; the `ON CONFLICT` upsert in `modify-item`. *Probe:* replace the upsert with
delete-then-insert — DE-15 goes red only because it uses a multi-attribute entity, which is
why it does.

### Bulk ingestion

**The items file mirrors `add-item` in data form.**
An entity and its attribute map, so an agent that has read `add-item --help` can write one
without a second lesson, and the two surfaces cannot drift into different models of what an
item is. The doc ratifies the grammar and the flow (RU-6) and never says what is in the file,
so this shape is owned here rather than derived.
*Cited:* DE-19; the `import` branch in `engine/main.ts`. *Probe:* none — this is a design choice,
not a claim about the code, and it is listed under *Owed to Ethan* for ratification rather
than defended here. An entry with no probe must say so.

**The sidecar is written once at the end, not once per item.**
The inspectable face is a pure function of the artifact, so a per-item rewrite is N passes
over a file whose only correct content is the last one.
*Cited:* DE-19's sidecar case, which asserts the final state and would pass either way.
*Probe:* *reasoned.* Moving `writeSidecar` inside the loop leaves every case green — it is
wasteful, not wrong, exactly as write-if-different makes directory-wide regeneration
wasteful rather than wrong (see IN-7 below). Recorded as a preference with no test behind
it, which is what it is.

**A partial ingestion reports as a structured error on stderr, not as a success payload.**
The obvious shape is exit 0 with a `rejected` array in the stdout payload. IN-9 forbids it:
one rule for the whole surface says a non-zero exit puts one object on stderr and leaves
stdout empty, and an agent piping stdout into a parser must never have a half-successful run
corrupt the parse. So the report *is* the error object — `fail()` grew an optional `detail`
argument to carry `ingested` and `rejected` on it — rather than the surface growing one rule
plus an exception for the only command that can be half-right.
*Cited:* DE-20, IN-9, IN-11; the partial branch in `import`, and `fail()` at
`engine/main.ts`. *Probe:* move the report to `succeed()` — DE-20's "the report is a
structured error" and IN-10's "partial ingestion" row both go red.

**What a bulk record must be is taken from `add-item`, never invented.**
An entity the graph already holds is refused under `entity_exists`, the same code the single
path uses; a record with no name is refused under `missing_value`, again `add-item`'s. The
rule is not "be strict", it is "be identical" — a bulk path stricter *or* laxer than the
single path forces an Operator to learn which one it is talking to. A whitespace-only name is
therefore accepted here, because `add-item` accepts it.
*Cited:* DE-20, DE-20.1. *Probe:* accept a colliding record as an update — DE-20's "the
offender changed nothing" goes red.

**A record with no entity reports `entity: null`, and one whose entity is not a string gets
its own code.**
An empty string is indistinguishable from a genuine empty name, so the report says the record
had no identifier and the index becomes the only handle. `entity: 2001` is a game called 2001
that YAML read as a number; the fix is quoting, which is a different action from naming, so it
is `invalid_entity` rather than `missing_value`. Coercing it silently was the alternative and
it is worse — a value this program invented, sitting in the Operator's data with nothing
saying so.
*Cited:* DE-20.1. *Probe:* restore `typeof item.entity === "string" ? item.entity : ""` —
three of DE-20.1's four cases go red, including the one where two nameless records collide
with each other and the report blames `entity_exists` on a name nobody wrote.

**The taken-names set grows as records land, rather than being a snapshot.**
A file naming the same entity twice is refused on its second mention exactly as it would be
against the artifact. Comparing against a snapshot read once is the obvious implementation and
it lets the duplicate through to SQLite, where the UNIQUE constraint kills the process
mid-batch — total collapse on one bad record, which is what partial-with-report exists to
replace.
*Cited:* DE-20.2. *Probe:* delete `taken.add(entity)` — both DE-20.2 cases go red. Note that
only one of them did until the probe was run: the crash left the artifact holding exactly the
rows the other case asserted, so it gained an exit-code assertion. A count that is right
because the program died before it could be wrong is not a claim.

**Nothing-ingested is still partial; "total failure" means the import itself failed.**
DE-20's sub-bullet invites a fourth outcome for a batch where nothing landed. Declined: the
exit alphabet has no code for it, and inventing one hands an agent a branch for an outcome
`ingested: 0` already states exactly. A missing source (2) and an unparseable one (1) are the
total failures — distinct in kind, since nothing was offered and there is nothing to report
per record.
*Cited:* DE-20.3. *Probe:* give the all-rejected case its own exit code — DE-20.3's first
case goes red, and IN-10's table rejects the new label as unlisted.

### The convention

**Amending the convention appends; it never overwrites.**
The schema said so before the command existed — `convention` is an ordered table with an
autoincrementing `seq`, not a single row. An Operator who learns in week three that ratings
run 1-10 rather than 1-5 is recording something that *became* true, and the earlier
expectation is how the items already in the graph are to be read. Overwriting would silently
re-date every one of them.
*Cited:* DE-21; `convention` in `engine/main.ts`, and the `convention` table in `SCHEMA`.
*Probe:* make `--append` replace the last row — DE-21's ordering case goes red, and so does
the `introduce` read-back.

**The amend answers with the whole convention, and rewrites the sidecar only on a write.**
An agent that amends needs to know what the graph now says about itself before its next
write; returning only the addition costs it a second call. And a read is a read — regenerating
the derived face from a command that changed nothing is the IN-4.1 failure.
*Cited:* DE-21, IN-4.1. *Probe:* return `{ appended }` instead of the list — DE-21's "the
amend call itself answers with the whole convention" goes red.

### The inspectable face

**`inline()` collapses CR/LF/CRLF to a visible `\n` and touches nothing else.**
Backslashes are deliberately *not* escaped: `C:\games` is an ordinary value in this domain and
doubling it would make every sidecar pay for the rare case. The accepted tradeoff is that a
value containing the literal characters `\n` renders identically to one containing a newline —
ambiguous, but structurally harmless, which is the property that matters.
*Cited:* DE-19.7; `inline()` at `engine/main.ts`. *Probe:* also escape backslashes —
nothing goes red, which is the point: the choice is not pinned by a case, so it is recorded
here instead. Reversing it is cheap and legitimate; doing so by accident is what this entry
prevents.

**Applied to every interpolation, including the namespace.**
The namespace was the one that got missed: it lands in the sidecar's H1 and in the prose line
telling the reader how to open the graph.
*Cited:* DE-19.7.1; commit `6234f9c`. *Probe:* remove `inline()` from the namespace
interpolation only — DE-19.7.1 goes red while DE-19.7 stays green.

**A control character in a namespace is rejected, not escaped.**
The asymmetry with attribute values is the point. A namespace is a filename and an identifier
the Operator types back, so a control character in one is never anything but a mistake or an
attack — there is no legitimate content being refused. An attribute value is the User's own
data, and refusing it would be the engine putting words in their mouth. Escape data; reject
identifiers. Both interpolations are *also* escaped, so a future loosening of the validator
cannot forge a heading on its way to the page.
*Cited:* DE-19.4, DE-19.7.1; the control-character test in the namespace validator.
*Probe:* drop the control-character test — DE-19.7.1 goes red. *Probe:* apply the same
rejection to attribute values — DE-23 goes red, which is the asymmetry being asserted.

**`writeSidecar` writes only when the rendering differs.**
The sidecar is a pure function of the artifact, so an identical rewrite costs an mtime for
nothing — and an mtime that moves when nothing changed is a lie told to anyone watching the
directory. It is also what makes IN-7's isolation guarantee *structural* rather than
incidental, and what makes regeneration safe on the read path.
*Cited:* IN-7; `writeSidecar()` at `engine/main.ts`. *Probe:* write unconditionally —
IN-7 goes red. Note the converse does **not** hold: see the IN-7 entry under failure
patterns, where this exact property defeated the case's own stated rationale.

**"Never read" means nothing is ever taken from the file.**
Since IN-4, `writeSidecar` opens the `.md` to compare. Behaviorally harmless — it compares and
discards — but the primer told the Operator the file is "never read back" while the code read
it. The claim is about trust, not about file handles, and it is worth being exact about which
one is being made. Reworded rather than reverted, in three places.
*Cited:* DE-19.8.2; commit `d56c485`. *Probe:* *reasoned.* No case asserts the wording, and
one that grepped the primer for a phrase would be a bad case. This entry exists because the
alternative fix — reverting write-if-different to make the old sentence true — would have
been the wrong repair, and that reasoning is not recoverable from the diff.

### `--pretty`

**Depth 0 reflows; everything deeper is inlined.**
That depth is a real boundary rather than a convenient one: the top-level fields of a payload
are text the engine wrote — the primer, the introduction — and reflowing them is the entire
reason `--pretty` exists. Everything nested below is text it was handed. Reflowing *that* lets
an attribute value of `count: 999` render as a field the payload does not have.
*Cited:* DE-19.7.1, DE-19.8.2; `prettyLines()` at `engine/main.ts`. *Probe:* reflow at
every depth — DE-19.7.1 goes red on the forged field.

**Emptiness is rendered, not omitted.**
A bare label with nothing under it cannot be told apart from a renderer that stopped, and the
reader has no way to check. Array items carry a bullet so the boundary between two is
countable — otherwise the blank line after an attribute-less item *is* the boundary, and the
case where the reader most needs it is the case where it disappears.
*Cited:* DE-19.8.2; commit `d56c485`. *Probe:* omit empty objects instead of printing
`label: (none)` — DE-19.8.2 goes red.

**The renderer walks the payload generically.**
No command's shape is known to it, so a command added later is readable without anyone
remembering to teach it.
*Cited:* `prettyText()` at `engine/main.ts`; DE-19.8's sweep. *Probe:* `import` landed in
DE-19 with no `--pretty` work at all and IN-9's `--pretty` rows covered it immediately. Run
on 2026-09-09 — this is the claim being observed rather than argued.

### The filesystem

**No WAL.**
It leaves `-wal`/`-shm` beside the database, and a graph copied without them has silently lost
its most recent writes. One short-lived process per command needs no concurrency, so nothing
is being traded away. Revisit only when concurrent Operators become real — and revisit IN-6
*with* it, not instead of it.
*Cited:* IN-6; `CLAUDE.md`'s standing instruction. *Probe:* add `PRAGMA journal_mode = WAL` —
IN-6 goes red on the stray files.

**`--dir` creates one level and says so; two is refused.**
A missing directory is two different acts wearing one spelling. `--dir ./graphs` from a
directory the User chose is an ordinary "make me a folder for this"; `--dir ./Documnets/graphs`
is a typo, and creating it makes the mistake real — the graph lands somewhere nobody will ever
open, reported as success. The parent is exactly where the two stop looking alike. Creation is
never silent.
*Cited:* DE-7.1; commit `98cd148`. *Probe:* use `mkdirSync(..., { recursive: true })` —
DE-7.1 goes red on the two-level case.

**Temp-root detection asks about the nearest *existing* ancestor.**
A path that does not exist cannot be `realpath`'d, so where the temp root is a symlink
(macOS: `/var/folders` behind `/private/var`) the guard compared an unresolved path against a
resolved one and did not fire. Temp-ness is a property of where a directory sits, so the
ancestor answers the same question with a path the filesystem can speak about.
*Cited:* DE-7.1; `nearestExisting()` at `engine/main.ts`, used by `isUnderTempRoot()` at
`engine/main.ts`. *Probe:* *reasoned on this machine.* The symlink shape does not exist on
Windows, so the fix cannot be shown red here. It is retained because the reasoning is sound and
the cost is one function; a macOS run would settle it. Flagged rather than claimed.

**The guard stays quiet in an ordinary directory.**
A warning that fires everywhere is one an Operator learns to scroll past, and then the real one
is invisible too.
*Cited:* DE-7, which is deliberately two-directional. *Probe:* emit `created_directory`
unconditionally — DE-7 goes red on the existing-directory half. That the case has a negative
half is the entry.

---

## Failure patterns that keep recurring

Each cost a slice to find, and all of them will happen again. These are the entries most
likely to *not* have a probe, because a pattern is a claim about future mistakes rather than
about current code — where that is so, it says so.

**Silent success.** The command does the wrong thing and reports 0. Every instance so far:
`process.exit(undefined)`; `--dir` with no value; `--dir` inventing a tree; a namespace of
`../escaped` writing outside the target; `initialize` destroying a pre-existing `notes.md`.
The tell is always that a *reasonable* input produces a *plausible* result — nothing
downstream can detect it, because the artifact is well-formed, it is just the wrong artifact.
When adding a code path, ask what it does with input that is wrong but not malformed.
*Cited:* DE-19.4, DE-19.5, DE-19.6, DE-7.1 — five instances, five slices. *Probe:* the
frequency is the evidence; the list is falsified by a sixth instance arising from something
other than a wrong-but-well-formed input.

**One face hardened, another added.** DE-19.7 escaped the sidecar. DE-19.8 then added
`--pretty` with no guard, and the same forgery worked again.
*Cited:* commits `2558210` then `3c9fd5b` then `6234f9c` — the gap between the second and
third is the pattern, visible in the log.

**The likelier error fires first.** DE-19.6's grammar sweep runs every value-taking flag in an
empty directory and asserts only `exitCode !== 0`. Every row fails on `no_graph_here`,
`missing_option` or `not_implemented` — never on the rule under test. It passed against the
pre-fix engine. A sweep must give each row enough context to reach the code being tested, and
assert the error code **by name**.
*Cited:* DE-19.6.1; commit `c5f4e1b`. *Probe:* this pattern recurred on 2026-09-09 in DE-19 —
`import --graph` answered `missing_option`, the more likely error, ahead of the `missing_value`
under test. Two independent occurrences, the second predicted by the first.

**Green on arrival is not evidence.** A case that has never been red has not been shown to test
anything. Break the specific behavior, watch the specific case fail, revert, record the probe
in the commit message.
*Cited:* DE-22, DE-23, IN-6, IN-7 were all green on arrival and all probed. *Probe:* twice the
probe disproved the case's own stated rationale — IN-7's mtime test does not catch
directory-wide regeneration (write-if-different makes that engine wasteful rather than wrong)
and needed a two-part probe; DE-19.7's `not.toContain` was too strong, since the forged text
appearing *inside* a line is the escaped value being legible. A pass rate of 2 wrong
rationales out of 4 green-on-arrival cases is the argument.

**Non-idempotent commands cannot be run twice and diffed.** `initialize`, `add-item` and
`remove-item` answer differently the second time precisely because they worked the first.
*Cited:* four false reds in the IN-9 sweep came from comparing a plain run against a
`--pretty` re-run; commit `b9a37c9`.

**A snapshot baseline must include what setup wrote.** Taking `readdirSync` before writing the
profile fixture asserts that writing the profile left a file behind — true, and not the point.
*Cited:* IN-6; commit `a4edde6`.

**Editing a frozen file's import line is a removal.** The guard rejects it. Add a *separate
new* import line instead.
*Cited:* caught twice, the second time by the guard, which is the guard working. *Probe:* a
third instance on 2026-09-09 in a different disguise — a rename script rewrote a *comment* in
`testing/evals/eval_smoke.ts`, which is frozen for the same reason. The guard cannot tell a
comment from an assertion and should not have to. See `testing/DISPUTES.md`.

---

## Empirical claims and how to re-verify them

Everything here was observed on this machine unless marked otherwise. All of it is free to
re-check — no API spend. An unverifiable row does not belong in this table.

| ID | Claim | Why it matters | Verification |
|---|---|---|---|
| **EN1** | `process.exit(undefined)` exits **0**. | The whole reason typecheck is in the gate. A missing key on the exit-code map turns every failure into a reported success. | `bun -e 'process.exit(undefined)'; echo $?` — run 2026-09-09, printed `0`. |
| **EN2** | `tsc` catches an undefined `EXIT` member; `bun test` does not. | Same. The suite is structurally blind to it, because the assertion reads the same wrong value the code does. | Delete a key from `EXIT`, run `bun run typecheck` then `bun test`. |
| **EN3** | No `-wal`/`-shm` files are produced. | IN-6, and the doc's portability claim that the artifact is *a file*. | `bun run check`, or add `PRAGMA journal_mode = WAL` and watch IN-6 fail. |
| **EN4** | Creating a `.sqlite` under `testing/.scratch/` costs ~1.8 s median, up to ~4.6 s; the identical command under `%TEMP%` costs ~104 ms. `--help` in the same directory is 64 ms. | Six runs each. Real-time AV scanning a developer directory that `%TEMP%` is exempt from — environment, not engine. It is why `bun test` runs with `--timeout 20000`. The default 5 s timeout failed DE-7 and DE-19.4 in about half of all runs, and an intermittently-lying suite is worse than a red one. | Time `initialize` in both locations. Re-measure if the suite starts flaking again. |
| **EN5** | A read-only sidecar that is *stale* makes an unguarded `writeSidecar` throw `EPERM`; a read-only sidecar that is *current* does not. | Write-if-different means the crash only reproduces when content actually differs. Anyone re-testing IN-4.1 will otherwise conclude it was never broken. | Edit the `.md`, `chmod 0o444` it, run `query`. |
| **EN6** | `Bun.YAML.parse` handles both the profile and the items formats with no dependency. | The repo adds no external deps. JSON-quoted values in the fixtures are valid YAML and survive apostrophes, `=`, non-ASCII and newlines without a YAML writer. | `writeProfileYml` round-trips in DE-6/DE-23; `writeItemsYml` in DE-19, landed 2026-09-09. |
| **EN7** | On POSIX a filename containing a newline is creatable. | Why the namespace validator rejects control characters rather than relying on the filesystem to. | **Reasoned, not observed** — not reproducible on Windows, which is exactly why it needed writing down. Weakest row in the table; a POSIX run settles it. |
| **EN8** | With `UNBUILT` empty (the standing state since DE-21), returning a *built* command to it grows the suite from 302 tests to 307 and reds exactly 3. | The five revived tests prove the sweep is derived from the CLI rather than absent; the three failures prove a false `UNBUILT` entry is caught rather than believed. Superseded the original measurement, which could only show the rows going quiet. | Edit `UNBUILT` to `new Set(["convention"])`, run `bun test testing/tests`. Run 2026-09-09. |

---

## Owed to Ethan

- **The `items.yml` shape is mine, not the doc's.** The doc ratifies
  `cog-graphs import --graph <ns> --from <items.yml>` and never says what is in the file. It
  mirrors `add-item` in data form so an agent that read `add-item --help` can write it without
  a second lesson, and the two surfaces cannot drift into different models of what an item is.
  Ratify or replace.
- **The IN-9/10/11 amendment was applied under precedent, not under a direct ruling.** The
  "unbuilt command" row named `import` in a literal — the identical defect Ethan resolved in
  DE-19.3 — in a file that dispute did not name. Recorded in `testing/DISPUTES.md`; confirm or
  reverse.
- **Minted-case numbering.** Seven cases use subject-based sub-numbering (DE-7.1, IN-4.1,
  IN-10.1) rather than the mint-by-slice rule. Recorded as an open question in `CLAUDE.md`.
  DE-20.1/.2/.3 are neutral on it — found at DE-20 and extending DE-20, so both rules agree.
- **`index` is zero-based, and that is my call.** DE-20 asks the report to name an offender
  "by position", which is ambiguous between the ordinal a human counts and the subscript an
  agent indexes with. The field is named `index` so the name settles it, and the reader is an
  agent about to go back into the array it just wrote. Ratify or flip.
- **Two entries above have no probe and say so** — the `items.yml` shape and the once-at-the-end
  sidecar write. Both are preferences rather than pinned behavior. If either matters, it wants
  a case; if neither does, they can come out.
