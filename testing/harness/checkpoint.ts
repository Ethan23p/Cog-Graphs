// Checkpoints — the mechanism IN-5 is defined in terms of.
//
// IN-5 says no item present at an earlier checkpoint is absent or corrupted at a later
// one, except where the scenario deliberately changed it. That sentence needs three things
// to be mechanical rather than a matter of opinion: a checkpoint has to be a value, the
// comparison has to be exact, and "deliberately" has to be *declared in advance* rather
// than decided while reading the diff.
//
// So: `capture()` reads every graph in a directory into a plain object, and `regressions()`
// compares consecutive checkpoints, taking the set of entities each step was permitted to
// touch. An entity that changed without permission is a violation with its own name on it.
//
// Deliberately SDK-free and agent-free. The paid Walking Skeleton eval calls this between
// turns; the free IN-5 case calls it between CLI invocations. One implementation, so the
// invariant means the same thing in both places — an invariant checked two different ways
// is two invariants.

import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import * as path from "node:path";

/** One entity: its attribute/value pairs, exactly as stored. */
export type ItemState = Record<string, string>;

/** One graph: entity name to its attributes. */
export type GraphState = Record<string, ItemState>;

export interface Checkpoint {
  /** What had just happened when this was taken. Appears verbatim in violations. */
  label: string;
  /** Namespace to contents, for every graph found in the directory. */
  graphs: Record<string, GraphState>;
}

export interface Violation {
  kind: "vanished" | "corrupted" | "graph_vanished";
  graph: string;
  entity?: string;
  attribute?: string;
  from: string;
  to: string;
  detail: string;
}

/**
 * Read every `.sqlite` in `dir` (recursively) into a checkpoint.
 *
 * Read-only, and it never creates: a directory with no graphs yields no graphs rather
 * than an empty file. The read goes through SQL rather than through `query`, on purpose —
 * a checkpoint taken with the CLI would go blind to exactly the defects that break the
 * CLI, and IN-5 is the case that has to notice the artifact rotting underneath it.
 */
export function capture(dir: string, label: string): Checkpoint {
  const graphs: Record<string, GraphState> = {};
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const rel = String(entry).replaceAll("\\", "/");
    if (!rel.endsWith(".sqlite")) continue;
    const namespace = path.basename(rel, ".sqlite");
    const db = new Database(path.join(dir, rel), { readonly: true });
    try {
      const state: GraphState = {};
      for (const row of db
        .query("SELECT id, name FROM entity")
        .all() as { id: number; name: string }[]) {
        state[row.name] = {};
      }
      const byId = new Map(
        (db.query("SELECT id, name FROM entity").all() as { id: number; name: string }[]).map(
          (r) => [r.id, r.name],
        ),
      );
      for (const row of db
        .query("SELECT entity_id, attribute, value FROM eav")
        .all() as { entity_id: number; attribute: string; value: string }[]) {
        const name = byId.get(row.entity_id);
        // An orphaned EAV row is IN-1's business, not IN-5's, and silently dropping it
        // here would hide it from both. Recorded under a name no entity can have.
        const key = name ?? `<orphan:${row.entity_id}>`;
        (state[key] ??= {})[row.attribute] = row.value;
      }
      graphs[namespace] = state;
    } finally {
      db.close();
    }
  }
  return { label, graphs };
}

/**
 * Every way a later checkpoint contradicts an earlier one, minus what was permitted.
 *
 * `permitted(from, to)` is asked for the entity names the step between two checkpoints was
 * allowed to change or remove. It is asked per step rather than given once, because a
 * scenario that may modify `Portal` at step 4 has said nothing about step 7 — a blanket
 * allowance would quietly excuse the corruption this case exists to catch.
 *
 * Additions are never violations: the invariant is about what was already there.
 */
export function regressions(
  checkpoints: Checkpoint[],
  permitted: (from: Checkpoint, to: Checkpoint) => Iterable<string> = () => [],
): Violation[] {
  const out: Violation[] = [];
  for (let i = 1; i < checkpoints.length; i++) {
    const from = checkpoints[i - 1]!;
    const to = checkpoints[i]!;
    const allowed = new Set(permitted(from, to));

    for (const [namespace, before] of Object.entries(from.graphs)) {
      const after = to.graphs[namespace];
      if (!after) {
        out.push({
          kind: "graph_vanished",
          graph: namespace,
          from: from.label,
          to: to.label,
          detail: `graph '${namespace}' was present at '${from.label}' and is gone at '${to.label}'`,
        });
        continue;
      }
      for (const [entity, attributes] of Object.entries(before)) {
        if (allowed.has(entity)) continue;
        const now = after[entity];
        if (!now) {
          out.push({
            kind: "vanished",
            graph: namespace,
            entity,
            from: from.label,
            to: to.label,
            detail: `'${entity}' was present at '${from.label}' and is absent at '${to.label}'`,
          });
          continue;
        }
        for (const [attribute, value] of Object.entries(attributes)) {
          if (now[attribute] === value) continue;
          out.push({
            kind: "corrupted",
            graph: namespace,
            entity,
            attribute,
            from: from.label,
            to: to.label,
            detail:
              `'${entity}'.${attribute} was ${JSON.stringify(value)} at '${from.label}' and is ` +
              `${JSON.stringify(now[attribute])} at '${to.label}'`,
          });
        }
      }
    }
  }
  return out;
}
