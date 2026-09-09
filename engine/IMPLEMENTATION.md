# Engine — Implementation Decisions

> **Status**: opened 2026-09-09, covering the v0.3.1 build loop through DE-19.8.2.
> **Purpose**: the decisions `engine/main.ts` embodies, why each was taken, and what
> was rejected. The design doc owns *what* the engine must do. This file owns *how*,
> and — more usefully — *why not the other way*.

## What belongs here, and what does not

| File | Owns |
|---|---|
| `Cog-Graphs` page in Logseq | The spec. Scope, entities, capabilities, roadmap, cases. Authoritative. |
| `testing/CASES.md` | Every case there is, in slice order, plus minted ones. Navigation. |
| `testing/DISPUTES.md` | A landed case that looks *wrong*. Ethan resolves. |
| `testing/harness/IMPLEMENTATION.md` | The eval runtime and its SDK claims. |
| **this file** | Engine decisions, the reasoning that produced them, and the failure patterns that keep recurring. |

The bar for an entry: a future engineer could plausibly undo it by accident. A decision
whose reversal would be obviously wrong does not need writing down; one that looks like
tidying does.

Commit messages carry the same reasoning at higher fidelity and are the primary record —
`git log --oneline` plus a `git show` on any case ID gets the full argument. This file
exists because that record is unsearchable across decisions: you can find why DE-19.7
happened, but not "everything we decided about the sidecar."

---

## The one invariant everything else falls out of

**The `.sqlite` is authoritative. The `.md` is a view of it. Nothing is ever taken back
from the view.**

Half the decisions below are this rule applied to a new situation. When a new question
comes up about the two faces, answer it from here before inventing anything.

Consequences, each of which was a separate slice before the pattern was obvious:

- Escaping happens at **render** time, never at write time. The database keeps exactly
  what it was given; the rendering is what has to be honest about it. (DE-19.7)
- A view that cannot be refreshed is a **warning**, never a failure. The answer is still
  correct, and on a write the artifact has already committed — failing there would report
  a loss that did not happen. (IN-4.1)
- Any face the engine renders needs the same guard. Hardening the sidecar did not harden
  `--pretty`, which did not exist yet. (DE-19.7.1)
- `initialize` refuses when **either** face's filename is occupied. A file at
  `notes.md` is not presumed to be ours. Everything the artifact owns, it created. (DE-19.5)

---

## Decisions

### Output and errors

**Every non-zero exit code in the alphabet is defined explicitly.**
A partial `EXIT` map is not a partial feature, it is a silent success: `EXIT.ALREADY_EXISTS`
reads `undefined`, `process.exit(undefined)` exits **0**, and the command prints a perfectly
good error on stderr while telling the shell it succeeded. Every case asserting an exit code
passes against that. This shipped, briefly, and was found by running `tsc` — which had been
flagging six call sites the whole time. `bun run check` exists because of it.

**Errors go to stderr, successes to stdout, never both.**
So an agent can pipe stdout into a parser without a failure corrupting the parse. A command
writing to both has broken the contract even when each stream is individually well-formed —
which is why IN-9 asserts the *quiet* stream is empty, not just that the loud one parses.

**Warnings ride in the payload, not on stderr.**
Otherwise a success becomes something the Operator has to parse two streams to understand,
and IN-9's "one JSON object on one stream" stops holding. `runtimeWarnings` collects
warnings raised by machinery rather than by the command and `succeed()` merges them in.
The `warnings` key is preserved when a command supplied one *even if empty* — DE-7 reads it
either way.

**`next_step` names something to do.**
A command, a flag, or a file. It is the field that makes an error worth having and the
first one to decay into a restatement of the message. Degrading every `next_step` to
"Something went wrong." fails 12 cases; that is the probe.

**Bare `cog-graphs` exits 0.**
Asking a tool what it is has not gone wrong. A zero-priming agent typing the binary name
did the most sensible thing available; answering with a failure code teaches it otherwise.
Reviewed and kept deliberately — IN-10's table pins it with the reasoning inline.

**A leading `--flag` that isn't global is `unknown_option`, not `unknown_command`.**
Told "'--nonsense' is not a command", an agent starts guessing command names — the one move
that cannot help. (DE-19.8.1)

### Argument parsing

**A flag written without a value is an error, never a default.**
`--dir` with nothing after it silently used the working directory: the one flag whose entire
purpose is controlling where the User's artifact lands, doing the opposite of what was asked,
at exit 0. An Operator who writes a flag has stated an intention; if the value did not survive
whatever produced the command line, a guess is the one response that cannot be right, because
the guess is invisible. `valueAfter()` is the single choke point; `optionValue` and
`optionValues` both route through it. (DE-19.6)

**The command is the first token that is not a global flag.**
`--pretty query` and `query --pretty` are the same request. Reading `argv[0]` meant
`cog-graphs --pretty` — advertised verbatim in the overview's own output line — was answered
"'--pretty' is not a cog-graphs command". (DE-19.8.1)

**`--attr key=value` splits on the *first* `=` only.**
Splitting on every `=` and rejecting the rest refuses ordinary values: a URL with a query
string, a formula. Source fidelity is the doc's default assumption. (DE-23)

**`modify-item` sets the named attributes and leaves the rest alone.**
The tempting shortcut — delete the entity's rows, write the given pairs as the whole record —
is indistinguishable from correct on a single-attribute item and silently erases everything
else on any other. (DE-14/DE-15)

### The inspectable face

**`inline()` collapses CR/LF/CRLF to a visible `\n` and touches nothing else.**
Backslashes are deliberately *not* escaped: `C:\games` is an ordinary value in this domain and
doubling it would make every sidecar pay for the rare case. The tradeoff accepted is that a
value containing the literal two characters `\n` renders identically to one containing a
newline — ambiguous, but structurally harmless, which is the property that matters.

**Applied to every interpolation, including the namespace.**
The namespace was the one that got missed: it lands in the sidecar's H1 and in the prose line
telling the reader how to open the graph. (DE-19.7.1)

**A control character in a namespace is rejected, not escaped.**
The asymmetry with attribute values is the point. A namespace is a filename and an identifier
the Operator types back, so a control character in one is never anything but a mistake or an
attack — there is no legitimate content being refused. An attribute value is the User's own
data and refusing it would be the engine putting words in their mouth. Escape data; reject
identifiers. Both interpolations are *also* escaped, so a future loosening of the validator
cannot forge a heading on its way to the page.

**`writeSidecar` writes only when the rendering differs.**
The sidecar is a pure function of the artifact, so an identical rewrite costs an mtime for
nothing — and an mtime that moves when nothing changed is a lie told to anyone watching the
directory. It is also what makes IN-7's isolation guarantee *structural* rather than
incidental, and what makes regeneration safe on the read path.

**"Never read" means nothing is ever taken from the file.**
Since IN-4, `writeSidecar` opens the `.md` to compare. Behaviorally harmless — it compares
and discards — but the primer told the Operator the file is "never read back" while the code
read it. The claim is about trust, not about file handles, and it is worth being exact about
which one is being made. Reworded rather than reverted. (DE-19.8.2)

### `--pretty`

**Depth 0 reflows; everything deeper is inlined.**
That depth is a real boundary rather than a convenient one: the top-level fields of a payload
are text the engine wrote — the primer, the introduction — and reflowing them is the entire
reason `--pretty` exists. Everything nested below is text it was handed. Reflowing *that*
lets an attribute value of `count: 999` render as a field the payload does not have. (DE-19.7.1)

**Emptiness is rendered, not omitted.**
A bare label with nothing under it cannot be told apart from a renderer that stopped, and the
reader has no way to check. Array items carry a bullet so the boundary between two is
countable — otherwise the blank line after an attribute-less item *is* the boundary, and the
case where the reader most needs it is the case where it disappears. (DE-19.8.2)

**The renderer walks the payload generically.**
No command's shape is known to it, so a command added later is readable without anyone
remembering to teach it.

### The filesystem

**No WAL.** It leaves `-wal`/`-shm` beside the database and a graph copied without them has
silently lost its most recent writes. One short-lived process per command needs no
concurrency, so nothing is being traded away. Enabling it fails IN-6 immediately; that is the
probe. Revisit only when concurrent Operators become real — and revisit IN-6 *with* it.

**`--dir` creates one level and says so; two is refused.**
A missing directory is two different acts wearing one spelling. `--dir ./graphs` from a
directory the User chose is an ordinary "make me a folder for this"; `--dir ./Documnets/graphs`
is a typo, and creating it makes the mistake real — the graph lands somewhere nobody will ever
open, reported as success. The parent is exactly where the two stop looking alike. Creation is
never silent. (DE-7.1)

**Temp-root detection asks about the nearest *existing* ancestor.**
A path that does not exist cannot be `realpath`'d, so where the temp root is a symlink
(macOS: `/var/folders` behind `/private/var`) the guard compared an unresolved path against a
resolved one and did not fire. Temp-ness is a property of where a directory sits, so the
ancestor answers the same question with a path the filesystem can speak about. (DE-7.1)

**The guard stays quiet in an ordinary directory.**
A warning that fires everywhere is one an Operator learns to scroll past, and then the real
one is invisible too. This is why DE-7 is a two-directional case and why `created_directory`
does not fire on an existing directory.

---

## Failure patterns that keep recurring

Written down because each one cost a slice to find and all of them will happen again.

**Silent success.** The command does the wrong thing and reports 0. Every instance so far:
`process.exit(undefined)`; `--dir` with no value; `--dir` inventing a tree; a namespace of
`../escaped` writing outside the target; `initialize` destroying a pre-existing `notes.md`.
The tell is always that a *reasonable* input produces a *plausible* result — nothing
downstream can detect it, because the artifact is well-formed, it is just the wrong artifact.
When adding a code path, ask what it does with input that is wrong but not malformed.

**One face hardened, another added.** DE-19.7 escaped the sidecar. DE-19.8 then added
`--pretty` with no guard, and the same forgery worked again. A guard belongs to the *class*
of rendered output, not to the renderer that existed when it was written.

**The likelier error fires first.** DE-19.6's grammar sweep runs every value-taking flag in an
empty directory and asserts only `exitCode !== 0`. Every row fails on `no_graph_here`,
`missing_option` or `not_implemented` — never on the rule under test. It passed against the
pre-fix engine. A sweep must give each row enough context to reach the code being tested, and
assert the error code **by name**. (DE-19.6.1)

**Green on arrival is not evidence.** A case that has never been red has not been shown to
test anything. Break the specific behavior, watch the specific case fail, revert, and record
the probe in the commit message. Twice this session the probe disproved the case's own stated
rationale: IN-7's mtime test does not catch directory-wide regeneration (write-if-different
makes that engine wasteful rather than wrong) and needed a two-part probe; DE-19.7's
`not.toContain` was too strong, since the forged text appearing *inside* a line is the escaped
value being legible.

**Non-idempotent commands cannot be run twice and diffed.** `initialize`, `add-item` and
`remove-item` answer differently the second time precisely because they worked the first.
Four false reds in the IN-9 sweep came from comparing a plain run against a `--pretty` re-run.

**A snapshot baseline must include what setup wrote.** Taking `readdirSync` before writing the
profile fixture asserts that writing the profile left a file behind — true, and not the point.

**Editing a frozen file's import line is a removal.** The guard rejects it. Add a *separate
new* import line instead. This was caught twice, the second time by the guard, which is the
guard working.

---

## Empirical claims and how to re-verify them

Everything here was observed on this machine, not assumed. All of it is free to re-check —
no API spend.

| ID | Claim | Why it matters | Verification |
|---|---|---|---|
| **EN1** | `process.exit(undefined)` exits **0**. | The whole reason typecheck is in the gate. A missing key on the exit-code map turns every failure into a reported success. | `bun -e 'process.exit(undefined)'; echo $?` |
| **EN2** | `tsc` catches an undefined `EXIT` member; `bun test` does not. | Same. The suite is structurally blind to it because the assertion reads the same wrong value. | Delete a key from `EXIT`, run `bun run typecheck` then `bun test`. |
| **EN3** | No `-wal`/`-shm` files are produced. | IN-6, and the portability claim the doc makes about the artifact being *a file*. | `bun run check`, or add `PRAGMA journal_mode = WAL` and watch IN-6 fail. |
| **EN4** | Creating a `.sqlite` under `testing/.scratch/` costs ~1.8 s median, up to ~4.6 s; the identical command under `%TEMP%` costs ~104 ms. `--help` in the same directory is 64 ms. | Six runs each. This is real-time AV scanning a developer directory that `%TEMP%` is exempt from — environment, not engine. It is why `bun test` runs with `--timeout 20000` and why `makeOrdinarySandbox` is documented as slow. The default 5 s timeout failed DE-7 and DE-19.4 about half of all runs, and an intermittently-lying suite is worse than a red one. | Time `initialize` in both locations. Re-measure if the suite starts flaking again. |
| **EN5** | A read-only sidecar that is *stale* makes an unguarded `writeSidecar` throw `EPERM`; a read-only sidecar that is *current* does not. | Write-if-different means the crash only reproduces when content actually differs. Anyone re-testing IN-4.1 will otherwise conclude it was never broken. | Edit the `.md`, `chmod 0o444` it, run `query`. |
| **EN6** | `Bun.YAML.parse` handles the profile and items formats with no dependency. | The repo adds no external deps. JSON-quoted values in the fixtures are valid YAML and survive apostrophes, `=`, non-ASCII and newlines without a YAML writer. | `writeProfileYml` round-trips in DE-6 and DE-23. |
| **EN7** | On POSIX a filename containing a newline is creatable. | Why the namespace validator rejects control characters rather than relying on the filesystem to. Not reproducible on Windows, which is exactly why it needed writing down. | Reasoned, not observed on this machine. Flagged as such. |

---

## Owed to Ethan

- **The DE-19.3 dispute blocks `import` and will block `convention` identically.** See
  `testing/DISPUTES.md`. DE-19's cases are written and were watched red; they are parked at
  `testing/tests/import.test.ts.pending` and renaming that file is the whole of the work to
  resume.
- **Minted-case numbering.** Six cases use subject-based sub-numbering (DE-7.1, IN-4.1) rather
  than the mint-by-slice rule. Recorded as an open question in `CLAUDE.md`.
- **The `items.yml` shape is mine, not the doc's.** The doc ratifies
  `cog-graphs import --graph <ns> --from <items.yml>` and never says what is in the file. It
  mirrors `add-item` in data form — an entity and its attribute map — so an agent that read
  `add-item --help` can write it without a second lesson, and the two surfaces cannot drift
  into different models of what an item is. Ratify or replace.
