// The command table: each capability's help and its body, side by side.
//
// Help is data, and it is a deliverable: DE-5 sweeps every command for its required flags
// and a runnable example, and the doc expects an agent to reach fluency from `--help` alone.
// The gate validates against the same entries, so what help promises and what is enforced
// cannot drift. The table's order is the order the overview lists commands in.
//
// A command returns its answer or throws through `fail`. It never writes output, and it
// never touches the sidecar: it reports the graph it used, and `main.ts` syncs that once.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parseAttrs, type Answer, type Help, type Invocation } from "./cli";
import { BINARY, INTERFACE_SKILL_PRIMER, ITEMS_SAMPLE, PROFILE_SAMPLE, SYSTEM_INTRODUCTION } from "./docs";
import { fail, type Warning } from "./errors";
import {
  createGraph,
  graphFiles,
  isUnderTempRoot,
  isValidNamespace,
  listGraphs,
  PROFILE_DEFAULTS,
  select,
  SHOWN_PROFILE_FIELDS,
  withGraph,
} from "./graph";

export interface Context {
  invocation: Invocation;
  cwd: string;
  /** Name the graph this command used, so its sidecar is brought up to date afterwards. */
  touch(dbPath: string): void;
}

export interface Command {
  help: Help;
  /** Absent while the command is documented but not built. */
  run?: (context: Context) => Answer;
  /** What to do in the meantime, for an unbuilt command. Vague advice is not a next step. */
  unbuiltNote?: string;
}

/**
 * `introduce` answers as one of two things and the payload says which, so an Operator never
 * has to infer from the shape whether they were told about a graph or about the system.
 * Mirrors INTRO_SCOPE in the test contract.
 */
const INTRO_SCOPE_SYSTEM = "system";
const INTRO_SCOPE_INSTANCE = "instance";

/**
 * The graph this invocation is about.
 *
 * Naming it is always allowed; omitting it is a convenience that only holds while the answer
 * is unambiguous. When it is not, the engine says what it found rather than picking — an
 * Operator who meant graph A and silently got graph B has no way to notice.
 *
 * Every command that resolves a graph touches it, readers included, so a User who deleted or
 * edited the derived file gets it back current whatever command they happened to run (IN-4).
 */
function resolveGraph({ invocation, cwd, touch }: Context): { namespace: string; dbPath: string } {
  const requested = invocation.value("--graph");
  if (requested) {
    const dbPath = graphFiles(cwd, requested).db;
    if (existsSync(dbPath)) {
      touch(dbPath);
      return { namespace: requested, dbPath };
    }
    const present = listGraphs(cwd);
    fail(
      "graph_not_found",
      `No graph named '${requested}' in ${cwd}.`,
      present.length > 0
        ? `This directory holds: ${present.join(", ")}. Use one of those, or create '${requested}' with cog-graphs initialize --profile <file.yml>.`
        : `This directory holds no graphs at all. Create one with cog-graphs initialize --profile <file.yml>.`,
    );
  }

  const present = listGraphs(cwd);
  if (present.length === 1) {
    const dbPath = graphFiles(cwd, present[0]!).db;
    touch(dbPath);
    return { namespace: present[0]!, dbPath };
  }
  if (present.length === 0) {
    fail(
      "no_graph_here",
      `No graph in ${cwd}.`,
      "Create one with cog-graphs initialize --profile <file.yml>, or run the command from the directory that holds the graph.",
    );
  }
  fail(
    "ambiguous_graph",
    `${cwd} holds more than one graph: ${present.join(", ")}.`,
    `Name the one you mean with --graph, e.g. --graph ${present[0]}.`,
  );
}

/** A flag's value, refusing the empty string — the flag was written, but names nothing. */
function nonEmpty(invocation: Invocation, flag: string, message: string, next_step: string): string {
  const value = invocation.value(flag);
  if (!value) fail("missing_value", message, next_step);
  return value;
}

/** Read a YAML file the Operator pointed a flag at. */
function readYaml(
  resolved: string,
  unparseable: "profile_unparseable" | "source_unparseable",
  next_step: string,
): Record<string, unknown> {
  try {
    return (Bun.YAML.parse(readFileSync(resolved, "utf8")) ?? {}) as Record<string, unknown>;
  } catch (cause) {
    fail(unparseable, `${resolved} is not valid YAML: ${(cause as Error).message}`, next_step);
  }
}

export const COMMANDS: Record<string, Command> = {
  introduce: {
    help: {
      summary:
        "Introduce the Cog Graph in this directory. With no graph present, introduces the system itself instead of erroring — this is the root of the self-documentation either way.",
      usage: "cog-graphs introduce [--graph <namespace>] [--interface-skill]",
      required: {},
      optional: {
        "--graph": "Which graph to introduce, when the directory holds more than one.",
        "--interface-skill":
          "Return the operator primer: everything needed to initialize and drive a graph from the CLI directly.",
      },
      examples: ["cog-graphs introduce", "cog-graphs introduce --interface-skill"],
    },
    run(context) {
      const { invocation, cwd } = context;
      // The primer is about the system, not any one graph, so it answers before resolution.
      if (invocation.has("--interface-skill")) {
        return { scope: INTRO_SCOPE_SYSTEM, primer: INTERFACE_SKILL_PRIMER };
      }

      // The doc: introduce returns an introduction to *this instantiation*, "unless there's no
      // instantiation to be found, in which case it introduces this system". So the system
      // introduction is the fallback — only a genuinely graph-less directory earns it. A named
      // graph that does not exist is still an error: an Operator who asked for something
      // specific should not be answered about the system in general.
      if (!invocation.value("--graph") && listGraphs(cwd).length === 0) {
        return { scope: INTRO_SCOPE_SYSTEM, introduction: SYSTEM_INTRODUCTION };
      }

      // What a cold agent needs before it touches anything, and no more. Skipping the
      // description and convention is how a fresh thread ends up inventing its own attribute
      // names beside the established ones — the graph does not break, it just quietly stops
      // being coherent.
      const { namespace, dbPath } = resolveGraph(context);
      return withGraph(
        dbPath,
        (graph) => ({
          scope: INTRO_SCOPE_INSTANCE,
          graph: namespace,
          path: dbPath,
          profile: Object.fromEntries(graph.shownProfile().map((r) => [r.field, r.value])),
          convention: graph.convention(),
          // The attributes already in use are the handholds for a selection query, so an
          // agent can narrow on its first attempt instead of guessing names.
          contents: { entities: graph.entityCount(), attributes: graph.attributeNames() },
          next_steps: [
            `cog-graphs query --graph ${namespace}`,
            `cog-graphs add-item --graph ${namespace} --entity <name> --attr key=value`,
            `cog-graphs modify-item --graph ${namespace} --entity <name> --attr key=value`,
            "cog-graphs introduce --interface-skill",
          ],
        }),
        true,
      );
    },
  },

  initialize: {
    help: {
      summary:
        "Spawn a Cog Graph from a profile: creates <namespace>.sqlite and the derived <namespace>.md beside it.",
      usage: "cog-graphs initialize --profile <file.yml> [--dir <path>]",
      required: {
        "--profile":
          "Path to a .yml holding a 'profile:' map (namespace, description) and a 'convention:' string to seed the graph with. A sample is under 'files'.",
      },
      optional: {
        "--dir": "Directory to create the graph in. Defaults to the working directory.",
      },
      files: { "--profile": PROFILE_SAMPLE },
      examples: [
        "cog-graphs initialize --profile ./profile.yml",
        "cog-graphs initialize --profile ./profile.yml --dir 'D:/Shared Files'",
      ],
      notes: [
        "The artifact belongs to the User. Creating it under a temp directory is warned about, because a graph the User cannot find is a graph they do not have.",
      ],
    },
    run({ invocation, cwd, touch }) {
      const profilePath = nonEmpty(
        invocation,
        "--profile",
        "--profile needs the path to a .yml file.",
        "Write the profile to a .yml, then pass its path: cog-graphs initialize --profile ./profile.yml",
      );
      const resolved = path.resolve(cwd, profilePath);
      if (!existsSync(resolved)) {
        fail(
          "profile_not_found",
          `No profile file at ${resolved}.`,
          "Write the profile to a .yml first, then pass that path to --profile.",
        );
      }

      const doc = readYaml(
        resolved,
        "profile_unparseable",
        "Fix the YAML and run initialize again. Quoting every value is the safe default.",
      );
      const profile = (doc.profile ?? {}) as Record<string, unknown>;
      // The convention is required at initialize, not optional. The doc has it "seeded upon
      // initialization" and treats it as always present when an agent touches a graph, so a
      // graph that starts without one starts with the discipline already broken — and there
      // is no moment later at which anyone is prompted to supply it.
      const seedConvention = typeof doc.convention === "string" ? doc.convention.trim() : "";
      if (typeof profile === "object" && profile !== null) {
        for (const [field, value] of Object.entries(PROFILE_DEFAULTS)) {
          if (typeof profile[field] !== "string") profile[field] = value;
        }
      }
      const missing = SHOWN_PROFILE_FIELDS.filter((field) => typeof profile[field] !== "string");
      if (missing.length > 0) {
        fail(
          "profile_incomplete",
          `The profile is missing: ${missing.join(", ")}.`,
          `Add the missing field(s) under 'profile:' in ${resolved}. Every profile needs: ${SHOWN_PROFILE_FIELDS.join(", ")}.`,
        );
      }
      if (seedConvention.length === 0) {
        fail(
          "convention_missing",
          "The profile file carries no 'convention:' to seed the graph with.",
          `Add a 'convention:' string to ${resolved} describing the shape of the data you are about to store — the attributes you will actually use, and what their values mean.`,
        );
      }

      const namespace = (profile.namespace as string).trim();
      if (!isValidNamespace(namespace)) {
        fail(
          "invalid_namespace",
          `'${profile.namespace}' cannot be a namespace: it must be a single name, not a path.`,
          `The namespace becomes the filename of the graph, so it may not contain '/' or '\\\\' or be empty. Pick a plain name like 'my-list' in ${resolved}, and use --dir to choose where the graph lands.`,
        );
      }

      const dir = path.resolve(cwd, invocation.value("--dir") ?? ".");
      // Warnings ride in the payload rather than on stderr, so success stays one parseable
      // object on one stream (IN-9).
      const warnings: Warning[] = [];

      // A --dir that does not exist yet is two different acts wearing one spelling (DE-7.1).
      // `--dir ./graphs` is "make me a folder for this"; `--dir ./Documnets/graphs` is a typo,
      // and creating it lands the graph somewhere nobody will ever open, reported as success.
      // The line is drawn at the parent, because that is exactly where the two stop looking
      // alike.
      if (!existsSync(dir)) {
        const parent = path.dirname(dir);
        if (!existsSync(parent)) {
          fail(
            "directory_not_found",
            `Neither ${dir} nor its parent ${parent} exists.`,
            `Check the path for a typo, or create the directory first and re-run. One new directory under one that already exists is made for you; a whole tree is not, because that is usually a mistyped path rather than an intention.`,
          );
        }
        mkdirSync(dir);
        // Created, but never silently: one who mistyped a level gets the cheapest possible
        // chance to notice, and one who meant it loses nothing by being told.
        warnings.push({
          code: "created_directory",
          message: `${dir} did not exist and was created for this graph.`,
          next_step: `If that is not where you meant the graph to go, remove it and re-run initialize with the --dir you intended.`,
        });
      }

      // The quiet failure this catches: an Assistant initializes the graph inside its own
      // ephemeral environment, every command succeeds, and the User never sees the artifact
      // again. A warning rather than a refusal, because a Cog Graph used as a scratch resource
      // is legitimate — the Operator is told what they are trading away and gets to decide.
      if (isUnderTempRoot(dir)) {
        warnings.push({
          code: "temp_directory",
          message:
            `This graph is being created under the platform temp directory (${tmpdir()}). Artifacts there are ` +
            `routinely deleted by the operating system and are usually invisible to the User, so the graph and ` +
            `everything put into it can disappear without anyone being told.`,
          next_step: `If this graph is meant to last, re-run initialize with --dir pointing somewhere the User owns, e.g. cog-graphs initialize --profile <file.yml> --dir <path>. If it is deliberately scratch, no action is needed.`,
        });
      }

      // Both faces are checked, not just the database. A User with `notes.md` in their
      // directory, whose Assistant sensibly picks the namespace `notes`, once lost the file at
      // exit 0. Everything the artifact owns is something the artifact created, so anything
      // already sitting on either name belongs to somebody else (DE-19.5).
      const files = graphFiles(dir, namespace);
      const occupied = [files.db, files.sidecar].filter((p) => existsSync(p));
      if (occupied.length > 0) {
        const isOurs = existsSync(files.db);
        fail(
          "artifact_exists",
          isOurs
            ? `A graph named '${namespace}' already lives at ${files.db}.`
            : `Cannot create '${namespace}' here: ${occupied.join(", ")} already exists and was not created by this graph.`,
          isOurs
            ? `Use it as it is — '${BINARY} introduce --graph ${namespace}' — or choose a different namespace in the profile.`
            : `A graph named '${namespace}' would write ${files.db} and ${files.sidecar}. Pick a different namespace in ${resolved}, or move the existing file, or use --dir to build the graph somewhere else.`,
        );
      }

      createGraph(files.db, profile as Record<string, string>, seedConvention);
      touch(files.db);
      return {
        graph: namespace,
        path: files.db,
        sidecar: files.sidecar,
        warnings,
        profile: Object.fromEntries(SHOWN_PROFILE_FIELDS.map((f) => [f, profile[f]])),
      };
    },
  },

  query: {
    help: {
      summary:
        "Pull items by attribute and value. An empty graph answers with an empty result, not an error.",
      usage: "cog-graphs query --graph <namespace> [--attr k=v ...] [--exclude k=v ...]",
      required: {},
      optional: {
        "--graph": "Which graph to query, when the directory holds more than one.",
        "--attr": "Include only items carrying this attribute/value pair. Repeatable.",
        "--exclude": "Drop items carrying this attribute/value pair. Repeatable.",
      },
      examples: [
        "cog-graphs query --graph my-list",
        "cog-graphs query --graph my-list --attr status=open --exclude priority=low",
      ],
      notes: [
        "Each attribute is a handhold: narrow repeated queries traverse the graph better than one broad one.",
      ],
    },
    run(context) {
      const { namespace, dbPath } = resolveGraph(context);
      const include = parseAttrs(context.invocation, "--attr");
      const exclude = parseAttrs(context.invocation, "--exclude");
      const items = withGraph(dbPath, (graph) => select(graph.items(), include, exclude), true);
      // An empty graph answers with the same shape as a full one. Answering `{}` or a null
      // items list when empty would force every caller to write the branch twice, and would
      // teach an Operator that a new graph is a broken one.
      return { graph: namespace, count: items.length, items };
    },
  },

  "add-item": {
    help: {
      summary: "Add one entity and its attribute/value pairs.",
      usage: "cog-graphs add-item --entity <name> [--graph <namespace>] [--attr k=v ...]",
      required: { "--entity": "The entity to create. Must not already exist." },
      optional: {
        "--graph": "Which graph to add to, when the directory holds more than one.",
        "--attr": "An attribute/value pair on the entity. Repeatable.",
      },
      examples: ["cog-graphs add-item --graph my-list --entity 'First item' --attr status=open"],
      notes: ["An entity that already exists is refused; use modify-item to change it."],
    },
    run(context) {
      const { namespace, dbPath } = resolveGraph(context);
      const entity = nonEmpty(
        context.invocation,
        "--entity",
        "--entity needs the name of the entity to add.",
        `Name it: cog-graphs add-item --graph ${namespace} --entity <name> [--attr key=value ...]`,
      );
      const attributes = parseAttrs(context.invocation);
      withGraph(dbPath, (graph) => {
        if (graph.entityId(entity) !== undefined) {
          fail(
            "entity_exists",
            `'${entity}' is already in ${namespace}.`,
            `Use modify item instead: cog-graphs modify-item --graph ${namespace} --entity '${entity}' --attr key=value`,
          );
        }
        graph.addEntity(entity, attributes);
      });
      return { graph: namespace, entity, attributes, added: true };
    },
  },

  import: {
    help: {
      summary: "Bulk-ingest many items from a .yml in one invocation.",
      usage: "cog-graphs import --from <items.yml> [--graph <namespace>]",
      required: {
        "--from":
          "Path to a .yml holding the items to ingest. A sample is under 'files'; it is the shape query returns.",
      },
      optional: { "--graph": "Which graph to ingest into, when the directory holds more than one." },
      files: { "--from": ITEMS_SAMPLE },
      examples: ["cog-graphs import --graph my-list --from ./items.yml"],
      notes: [
        "Partial with report: valid records are committed and invalid ones are rejected, never all-or-nothing. The exit code is distinct from both clean success and total failure, and the report arrives on stderr carrying 'ingested' and a 'rejected' list that names each offender by 'entity' and by 'index' — its zero-based position in the source's items list.",
        "A record is rejected on the same terms add-item would refuse it: an entity the graph already holds, or one already named earlier in the same file. Fix the named records and re-run import on a .yml holding only those.",
      ],
    },
    run(context) {
      const { namespace, dbPath } = resolveGraph(context);
      const from = nonEmpty(
        context.invocation,
        "--from",
        "--from needs the path to a .yml file of items to ingest.",
        `Write the items to a .yml, then pass its path: cog-graphs import --graph ${namespace} --from ./items.yml`,
      );
      const resolved = path.resolve(context.cwd, from);
      if (!existsSync(resolved)) {
        fail(
          "source_not_found",
          `No source file at ${resolved}.`,
          "Write the items to a .yml first, then pass that path to --from.",
        );
      }

      // The file mirrors add-item in data form — an entity and its attribute map — so an agent
      // that has read `add-item --help` already knows how to write one, and the two surfaces
      // cannot drift into two different models of what an item is.
      const doc = readYaml(
        resolved,
        "source_unparseable",
        "Fix the YAML and run import again. Quoting every value is the safe default.",
      );
      const records = Array.isArray(doc.items) ? doc.items : [];

      // `entity` is null on a record that failed to name one, rather than "": an empty string
      // is indistinguishable from a genuine empty name, and the index is then the only handle
      // the Operator has on that record (DE-20.1).
      const rejected: { index: number; entity: string | null; reason: string }[] = [];
      let ingested = 0;

      withGraph(dbPath, (graph) => {
        const now = new Date().toISOString();
        // Every name the graph already holds, read once, then *added to* as records land — so
        // a record colliding with an earlier record in the same file is rejected on the same
        // terms as one colliding with the artifact (DE-20.2).
        const taken = new Set(graph.entityNames());

        for (const [index, record] of records.entries()) {
          const item = (record ?? {}) as Record<string, unknown>;
          const named = item.entity;
          const attributes = (item.attributes ?? {}) as Record<string, unknown>;

          // A record with no name is refused, never ingested under "" — a row no query can
          // name and no modify-item can reach (DE-20.1).
          if (named === undefined || named === null || named === "") {
            rejected.push({ index, entity: null, reason: "missing_value" });
            continue;
          }
          // Its own reason, because it is its own fix. `entity: 2001` is a title YAML read as
          // a number; the answer is to quote it. Coercing it silently would put a value this
          // program invented into the Operator's data.
          if (typeof named !== "string") {
            rejected.push({ index, entity: null, reason: "invalid_entity" });
            continue;
          }
          // Rejected, not merged: a bulk path that quietly updated an existing entity would be
          // a second, laxer model of what an item is than add-item's (DE-20).
          if (taken.has(named)) {
            rejected.push({ index, entity: named, reason: "entity_exists" });
            continue;
          }

          graph.addEntity(
            named,
            Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, String(v)])),
            now,
          );
          taken.add(named);
          ingested++;
        }
      });

      // Partial is reported as a structured error rather than as a success payload with a
      // 'rejected' array in it. IN-9 gives the whole surface one rule — a non-zero exit puts
      // one object on stderr and leaves stdout empty — so the report *is* the error (DE-20).
      if (rejected.length > 0) {
        fail(
          "partial_ingestion",
          `${ingested} of ${records.length} records were ingested into ${namespace}; ${rejected.length} were rejected.`,
          "Read 'rejected' — each entry names the offending entity and its zero-based index in the source's items list. Fix those records, then re-run import on a .yml holding only them.",
          { graph: namespace, source: resolved, ingested, rejected },
        );
      }

      // The count is the whole of what a bulk Operator gets back, so it counts what landed,
      // not what was offered.
      return { graph: namespace, source: resolved, ingested };
    },
  },

  "modify-item": {
    help: {
      summary:
        "Change attribute/value pairs on an existing entity. Attributes not named are left alone.",
      usage: "cog-graphs modify-item --entity <name> [--graph <namespace>] [--attr k=v ...]",
      required: { "--entity": "The entity to change. Must already exist." },
      optional: {
        "--graph": "Which graph to modify, when the directory holds more than one.",
        "--attr": "An attribute/value pair to set. Repeatable.",
      },
      examples: ["cog-graphs modify-item --graph my-list --entity 'First item' --attr status=done"],
      notes: ["An entity that does not exist is refused; use add-item to create it."],
    },
    run(context) {
      const { namespace, dbPath } = resolveGraph(context);
      const entity = nonEmpty(
        context.invocation,
        "--entity",
        "--entity needs the name of the entity to modify.",
        `Name it: cog-graphs modify-item --graph ${namespace} --entity <name> --attr key=value`,
      );
      const attributes = parseAttrs(context.invocation);
      withGraph(dbPath, (graph) => {
        const id = graph.entityId(entity);
        if (id === undefined) {
          fail(
            "entity_not_found",
            `'${entity}' is not in ${namespace}.`,
            `Use add item instead: cog-graphs add-item --graph ${namespace} --entity '${entity}' --attr key=value`,
          );
        }
        graph.setAttributes(id, attributes);
      });
      return { graph: namespace, entity, attributes, modified: true };
    },
  },

  "remove-item": {
    help: {
      summary: "Remove one entity and everything recorded about it.",
      usage: "cog-graphs remove-item --entity <name> [--graph <namespace>]",
      required: { "--entity": "The entity to remove. Must already exist." },
      optional: { "--graph": "Which graph to remove from, when the directory holds more than one." },
      examples: ["cog-graphs remove-item --graph my-list --entity 'First item'"],
    },
    run(context) {
      const { namespace, dbPath } = resolveGraph(context);
      const entity = nonEmpty(
        context.invocation,
        "--entity",
        "--entity needs the name of the entity to remove.",
        `Name it: cog-graphs remove-item --graph ${namespace} --entity <name>`,
      );
      withGraph(dbPath, (graph) => {
        const id = graph.entityId(entity);
        if (id === undefined) {
          const present = graph.entityNames();
          fail(
            "entity_not_found",
            `'${entity}' is not in ${namespace}, so there is nothing to remove.`,
            present.length > 0
              ? `Check the name against what is there — ${namespace} holds: ${present.join(", ")}. 'cog-graphs query --graph ${namespace}' lists them with their attributes.`
              : `${namespace} is empty. Add something first: cog-graphs add-item --graph ${namespace} --entity <name>`,
          );
        }
        graph.removeEntity(id);
      });
      return { graph: namespace, entity, removed: true };
    },
  },

  convention: {
    help: {
      summary:
        "Read the graph's convention — the expectations the graph keeps about its own schema and metadata — or append to it.",
      usage: "cog-graphs convention [--graph <namespace>] [--append <text>]",
      required: {},
      optional: {
        "--graph": "Which graph's convention, when the directory holds more than one.",
        "--append": "Add an expectation to the convention.",
      },
      examples: [
        "cog-graphs convention --graph my-list",
        "cog-graphs convention --graph my-list --append 'every item carries a status of open | done'",
      ],
      notes: [
        "The convention lives in the artifact, not the engine. It is yours to keep honest: it should describe the data you actually store.",
      ],
    },
    run(context) {
      const { namespace, dbPath } = resolveGraph(context);
      // Absent and empty are different: `--append ''` appends an empty expectation, and a
      // dangling `--append` never reaches here (DE-19.6.1).
      const append = context.invocation.value("--append");
      const convention = withGraph(dbPath, (graph) => {
        if (append !== undefined) graph.appendConvention(append);
        return graph.convention();
      });
      // The amend answers with the whole convention rather than the addition, so an agent that
      // amends does not need a second call to learn what the graph now says about itself.
      return { graph: namespace, convention };
    },
  },
};

/**
 * Run the command the gate let through.
 *
 * A documented command with no body answers `not_implemented`, distinct from
 * `unknown_command` on purpose: that one means "you mistyped"; this means "you read the help
 * correctly and there is nothing behind it yet". An agent that cannot tell them apart retries
 * with a different spelling forever (DE-19.3).
 */
export function runCommand(name: string, context: Context): Answer {
  const command = COMMANDS[name]!;
  if (command.run) return command.run(context);
  const built = Object.keys(COMMANDS).filter((n) => COMMANDS[n]!.run);
  fail(
    "not_implemented",
    `'${name}' is documented but not implemented yet in this build.`,
    `Working commands: ${built.join(", ")}. ${command.unbuiltNote ?? `Use one of those, or run '${BINARY} --help'.`}`,
  );
}
