// The long prose of the self-documentation. Per-command help lives beside each command in
// commands.ts; this file holds what is shared or too long to sit in a table.
//
// Every example here is deliberately domain-neutral. An Operator copies the example it is
// shown: in the Walking Skeleton run of 2026-09-09T20-59, when the primer's example was a
// games list, the agent's profile reproduced it almost word for word, down to a name the User
// never gave. That makes the example part of the product's behavior, and it means an eval in
// the example's domain cannot tell a designed profile from a transcribed one. Keep examples
// free of any subject matter.

/** The binary's own name, as it appears in every example and error the engine emits. */
export const BINARY = "cog-graphs";

// The two files an Operator writes for the CLI, as samples it accepts verbatim. They are
// served under 'files' in the --help of the command that takes them, and the primer shows
// the same text, so there is one source for each shape (DE-5.1). DE-5.1 imports them back
// through the real parser, so help cannot drift from what the command accepts.
//
// The items shape is add-item in data form, and it is exactly what `query` returns, so a
// query's output imports as it is. Ethan ratified it on 2026-09-11.
export const PROFILE_SAMPLE = [
  "profile:",
  "  namespace: my-list",
  "  description: What this graph is for, in the User's words.",
  "convention: |",
  "  Every item carries a status.",
  "",
].join("\n");

export const ITEMS_SAMPLE = [
  "items:",
  "  - entity: First item",
  "    attributes:",
  "      status: open",
  "  - entity: Second item",
  "    attributes:",
  "      status: done",
  "      note: Anything the User said about it.",
  "",
].join("\n");

const indented = (text: string) => text.trimEnd().split("\n").map((line) => "  " + line);

export const SYSTEM_INTRODUCTION = [
  "Cog-Graphs spawns and manipulates persistent structured stores — a Cog Graph is an",
  "EAV store you create per use-case and keep in your working directory.",
  "",
  "There is no Cog Graph here yet. To make one, write a profile as a small .yml file",
  "(a namespace, a description, and a seed convention), then run:",
  "  cog-graphs initialize --profile <file.yml>",
].join("\n");

// The primer an Operator gets from `introduce --interface-skill`: everything needed to
// initialize and use a Cog Graph directly, and nothing else. It is the whole priming an
// agent operating the CLI is guaranteed to have, so every command the Walking Skeleton
// walks appears here in runnable form (DE-2).
export const INTERFACE_SKILL_PRIMER = [
  "# Operating a Cog Graph directly",
  "",
  "A Cog Graph is an EAV store: entities carry attribute/value pairs. It lives as two",
  "files in a directory the User owns — `<namespace>.sqlite`, which holds everything,",
  "and a derived `<namespace>.md` beside it, which is written for inspection and is never",
  "a source of truth. Do not hand-edit the `.md`; do not put either file in a temp directory,",
  "or the User loses the thing they were meant to keep.",
  "",
  "## Spawn one",
  "",
  "Establish the profile with the User conversationally — a namespace, and a",
  "description in their words — then write it to a one-time-use `.yml` and pass it in:",
  "",
  ...indented(PROFILE_SAMPLE),
  "",
  "  cog-graphs initialize --profile <profile.yml> [--dir <path>]",
  "",
  "The convention is the graph's own expectations about its schema — seed it with what",
  "you are actually about to store, and amend it as the shape of the data changes.",
  "",
  "## Look at what is there",
  "",
  "  cog-graphs query --graph <namespace> [--attr k=v ...] [--exclude k=v ...]",
  "",
  "An empty graph answers with an empty result, not an error. Query is the way to",
  "traverse: each attribute is a handhold, so ask narrow questions repeatedly rather",
  "than one broad one.",
  "",
  "## Put things in, change them",
  "",
  "  cog-graphs add-item --graph <namespace> --entity <name> [--attr k=v ...]",
  "  cog-graphs modify-item --graph <namespace> --entity <name> [--attr k=v ...]",
  "",
  "`add-item` refuses an entity that already exists and `modify-item` refuses one that",
  "does not, so the two never silently do each other's job.",
  "",
  "To bring in many at once, write them to a .yml and import it. The file is the shape",
  "`query` returns, so a query's output imports as it is:",
  "",
  ...indented(ITEMS_SAMPLE),
  "",
  "  cog-graphs import --graph <namespace> --from <items.yml>",
  "",
  "Import is partial with report: valid records land, and each rejected one is named.",
  "",
  "## Coming in cold",
  "",
  "  cog-graphs introduce --graph <namespace>",
  "",
  "Run this against an existing graph to be told what it is for and what convention it",
  "keeps. Every command answers `--help`; check it the first time you meet a surface",
  "rather than assuming the grammar has held still.",
].join("\n");
