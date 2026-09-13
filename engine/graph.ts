// The Cog Graph: the functional face and everything that touches it — the schema and every
// SQL statement, the profile's shape, selection search, and where graphs live on disk.
//
// Nothing here writes to stdout or exits. Outcomes are returned; the caller decides what
// they mean to an Operator.

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Warning } from "./errors";
import { renderSidecar } from "./render";

/**
 * The functional face. One file, self-contained, openable by anything that speaks
 * SQLite — the doc's requirement is that it "neatly contains *everything* functional",
 * so the profile and the convention live in here beside the data rather than in
 * companion files that can be separated from it.
 *
 * EAV rows hang off `entity` by id rather than repeating the name, which is what makes
 * "every EAV row resolves to a known entity" (IN-1) structural instead of a convention
 * the engine has to remember to honor.
 *
 * No WAL, deliberately: it would leave `-wal`/`-shm` files beside the database and
 * break IN-6, and one short-lived process per command needs no concurrency.
 */
const SCHEMA = `
  CREATE TABLE profile (
    field TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE convention (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
  CREATE TABLE entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE eav (
    entity_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    attribute TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (entity_id, attribute)
  );
`;

// ---------------------------------------------------------------------------------------
// The profile

/**
 * The fields the profile schema declares. Named once because both the writer and the
 * completeness check read it — the doc expects this list to grow ("probably more - TBD").
 */
export const PROFILE_FIELDS = ["namespace", "use-pattern", "description"] as const;

// use-pattern stays in the artifact so the manual/managed structure survives into later
// versions, but v0.3.1 has only 'manual' and the doc keeps the distinction out of view:
// "From the user-facing side, there is no such thing as `--managed`, yet." So it is
// defaulted rather than asked for, and withheld from every rendered surface — the primer,
// --help, the initialize payload, introduce, and the sidecar. Ethan, 2026-09-11: "it's not
// meaningful in v0.3.1, so it shouldn't be presented in the Operator/User-facing
// experience." When managed lands, this is the switch to remove.
export const PROFILE_DEFAULTS: Record<string, string> = { "use-pattern": "manual" };
const WITHHELD_PROFILE_FIELDS = new Set<string>(["use-pattern"]);
export const SHOWN_PROFILE_FIELDS = PROFILE_FIELDS.filter((f) => !WITHHELD_PROFILE_FIELDS.has(f));

/**
 * Can this be a namespace? It becomes a filename, so it has to be one path segment.
 *
 * Unvalidated, `../escaped` created the graph in the parent directory and reported success
 * — an artifact the User cannot find (DE-7), invisible to `listGraphs` too, so written and
 * lost in one command.
 *
 * Deliberately narrow. Dots, dashes and underscores are how real namespaces read —
 * `game-recs-Ethan`, `notes.2026` — and a validator that rejected them would push Operators
 * toward worse names to satisfy the tool.
 *
 * A control character is rejected rather than escaped downstream: a namespace is a filename
 * and an identifier the Operator types back, so one is never legitimate content. On POSIX a
 * filename containing a newline is creatable, and the namespace is interpolated into the
 * sidecar's H1 (DE-19.7.1). Escape data; reject identifiers.
 */
export function isValidNamespace(namespace: string): boolean {
  return (
    namespace.length > 0 &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(namespace) &&
    !namespace.includes("/") &&
    !namespace.includes("\\") &&
    path.basename(namespace) === namespace &&
    ![".", ".."].includes(namespace)
  );
}

// ---------------------------------------------------------------------------------------
// Reading and writing a graph

export interface Item {
  entity: string;
  attributes: Record<string, string>;
}

export function createGraph(
  dbPath: string,
  profile: Record<string, string>,
  convention: string,
): void {
  const db = new Database(dbPath, { create: true });
  try {
    db.exec(SCHEMA);
    const insertField = db.prepare("INSERT INTO profile (field, value) VALUES (?, ?)");
    for (const field of PROFILE_FIELDS) insertField.run(field, profile[field]!);
    db.prepare("INSERT INTO convention (text, recorded_at) VALUES (?, ?)").run(
      convention,
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}

/** Open a graph for the length of `use`, and close it however `use` ends. */
export function withGraph<T>(dbPath: string, use: (graph: Graph) => T, readonly = false): T {
  // `new Database(path, {})` opens with no mode flags at all and fails on first use, so the
  // writable form is spelled without options.
  const graph = new Graph(readonly ? new Database(dbPath, { readonly: true }) : new Database(dbPath));
  try {
    return use(graph);
  } finally {
    graph.close();
  }
}

export class Graph {
  constructor(private readonly db: Database) {}

  close(): void {
    this.db.close();
  }

  /** The entity's id, or undefined when the graph does not hold it. */
  entityId(name: string): number | undefined {
    return (this.db.query("SELECT id FROM entity WHERE name = ?").get(name) as { id: number } | null)
      ?.id;
  }

  entityNames(): string[] {
    return (this.db.query("SELECT name FROM entity ORDER BY name").all() as { name: string }[]).map(
      (e) => e.name,
    );
  }

  /**
   * Exactly what was supplied and nothing else — no inferred attributes, no defaults. The
   * doc's default assumption is source data at source fidelity, and an engine that helpfully
   * adds a field is an engine putting words in the Operator's mouth.
   */
  addEntity(name: string, attributes: Record<string, string>, createdAt = new Date().toISOString()): void {
    const { lastInsertRowid } = this.db
      .query("INSERT INTO entity (name, created_at) VALUES (?, ?)")
      .run(name, createdAt);
    const insertAttr = this.db.query("INSERT INTO eav (entity_id, attribute, value) VALUES (?, ?, ?)");
    for (const [attribute, value] of Object.entries(attributes)) {
      insertAttr.run(lastInsertRowid as number, attribute, value);
    }
  }

  /**
   * Set the named attributes and leave every other one alone. The tempting shortcut —
   * delete the entity's rows and write the given pairs as the whole record — is
   * indistinguishable from correct on a single-attribute item and silently erases
   * everything else on a real one (DE-13).
   */
  setAttributes(entityId: number, attributes: Record<string, string>): void {
    const upsert = this.db.prepare(
      "INSERT INTO eav (entity_id, attribute, value) VALUES (?, ?, ?) " +
        "ON CONFLICT (entity_id, attribute) DO UPDATE SET value = excluded.value",
    );
    for (const [attribute, value] of Object.entries(attributes)) upsert.run(entityId, attribute, value);
  }

  /**
   * The attribute rows go with the entity. Leaving them would orphan data that nothing can
   * retrieve and quietly break IN-1. Explicit rather than relying on ON DELETE CASCADE,
   * which SQLite only honors when foreign keys are switched on.
   */
  removeEntity(entityId: number): void {
    this.db.prepare("DELETE FROM eav WHERE entity_id = ?").run(entityId);
    this.db.prepare("DELETE FROM entity WHERE id = ?").run(entityId);
  }

  /** Every entity with its attribute/value pairs, entity name ascending. */
  items(): Item[] {
    const entities = this.db.query("SELECT id, name FROM entity ORDER BY name").all() as {
      id: number;
      name: string;
    }[];
    const attributes = this.db.query("SELECT entity_id, attribute, value FROM eav").all() as {
      entity_id: number;
      attribute: string;
      value: string;
    }[];
    return entities.map((entity) => ({
      entity: entity.name,
      attributes: Object.fromEntries(
        attributes.filter((a) => a.entity_id === entity.id).map((a) => [a.attribute, a.value]),
      ),
    }));
  }

  convention(): string[] {
    return (this.db.query("SELECT text FROM convention ORDER BY seq").all() as { text: string }[]).map(
      (r) => r.text,
    );
  }

  /**
   * Amend means append — `convention` is an ordered table, not a single row. An Operator who
   * learns in week three that ratings run 1-10 is recording something that *became* true, and
   * the earlier expectation is how the items already stored are to be read (DE-21).
   */
  appendConvention(text: string): void {
    this.db
      .prepare("INSERT INTO convention (text, recorded_at) VALUES (?, ?)")
      .run(text, new Date().toISOString());
  }

  /** The profile as an Operator is shown it: withheld fields left out, in stored order. */
  shownProfile(): { field: string; value: string }[] {
    return (this.db.query("SELECT field, value FROM profile").all() as { field: string; value: string }[]).filter(
      (r) => !WITHHELD_PROFILE_FIELDS.has(r.field),
    );
  }

  namespace(): string | undefined {
    return (
      this.db.query("SELECT value FROM profile WHERE field = 'namespace'").get() as { value: string } | null
    )?.value;
  }

  entityCount(): number {
    return (this.db.query("SELECT COUNT(*) AS count FROM entity").get() as { count: number }).count;
  }

  /** The attribute names in use — the handholds for a selection query. */
  attributeNames(): string[] {
    return (
      this.db.query("SELECT DISTINCT attribute FROM eav ORDER BY attribute").all() as { attribute: string }[]
    ).map((r) => r.attribute);
  }

  /** Everything the inspectable face shows, with attributes ordered by name. */
  sidecarContents(): { name: string; attributes: { attribute: string; value: string }[] }[] {
    const entities = this.db.query("SELECT id, name FROM entity ORDER BY name").all() as {
      id: number;
      name: string;
    }[];
    const attributes = this.db
      .query("SELECT entity_id, attribute, value FROM eav ORDER BY attribute")
      .all() as { entity_id: number; attribute: string; value: string }[];
    return entities.map((e) => ({
      name: e.name,
      attributes: attributes
        .filter((a) => a.entity_id === e.id)
        .map(({ attribute, value }) => ({ attribute, value })),
    }));
  }
}

// ---------------------------------------------------------------------------------------
// Selection search — the Library's one strategy in v0.3.1

/**
 * Simple inclusion/exclusion over attributes and values: every `include` pair must match
 * and no `exclude` pair may, which is what makes repeated narrow queries a way to traverse.
 *
 * A filtered result is still the whole item: narrowing chooses which items come back, never
 * which of their attributes do. Projecting down to the matched pairs would make query lossy
 * exactly when an Operator is closing in on something (DE-10.1).
 */
export function select(
  items: Item[],
  include: Record<string, string>,
  exclude: Record<string, string>,
): Item[] {
  return items.filter((item) => {
    for (const [attribute, value] of Object.entries(include)) {
      if (item.attributes[attribute] !== value) return false;
    }
    for (const [attribute, value] of Object.entries(exclude)) {
      if (item.attributes[attribute] === value) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------------------
// Where graphs live

/** The two files a graph named `namespace` occupies in `dir`. */
export function graphFiles(dir: string, namespace: string): { db: string; sidecar: string } {
  return { db: path.join(dir, `${namespace}.sqlite`), sidecar: path.join(dir, `${namespace}.md`) };
}

/** Namespaces of the graphs sitting in a directory, sorted. */
export function listGraphs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => name.slice(0, -".sqlite".length))
    .sort();
}

/**
 * Bring the inspectable face up to date with the functional one.
 *
 * Written only when the rendering actually differs from what is on disk. The sidecar is a
 * pure function of the artifact, so an identical rewrite is a no-op that costs an mtime —
 * and an mtime that moves when nothing changed is a lie told to anyone watching the
 * directory. It also makes this safe to run after a read (IN-4).
 *
 * The file is opened only to compare; nothing read from it reaches the artifact or an answer.
 *
 * Returns a warning, never throws, when the file cannot be written. The artifact is
 * authoritative and the sidecar is a view of it, so a view that cannot be refreshed is a
 * warning, never a failure: on a write the artifact has already been committed, and failing
 * here would report a loss that did not happen (IN-4.1). The User who hits this is usually
 * the careful one — the file's banner says "Derived file — do not edit", so they made it
 * read-only.
 */
export function syncSidecar(dbPath: string): Warning | undefined {
  const sidecar = path.join(path.dirname(dbPath), `${path.basename(dbPath, ".sqlite")}.md`);
  const rendered = withGraph(
    dbPath,
    (graph) =>
      renderSidecar({
        namespace: graph.namespace() ?? path.basename(dbPath, ".sqlite"),
        databaseFile: path.basename(dbPath),
        profile: graph.shownProfile(),
        convention: graph.convention(),
        entities: graph.sidecarContents(),
      }),
    true,
  );
  try {
    if (existsSync(sidecar) && readFileSync(sidecar, "utf8") === rendered) return undefined;
    writeFileSync(sidecar, rendered);
    return undefined;
  } catch (cause) {
    return {
      code: "sidecar_unwritable",
      message:
        `The derived ${path.basename(sidecar)} could not be rewritten (${(cause as Error).message}), so it no longer ` +
        `reflects the graph. Nothing was lost: everything real lives in ${path.basename(dbPath)}, and this command's answer is unaffected.`,
      next_step: `Make ${path.basename(sidecar)} writable, or delete it, then run any command against this graph to regenerate it.`,
    };
  }
}

/**
 * Is this path inside the platform temp root?
 *
 * Compared through `path.relative` rather than a string prefix, so a sibling directory
 * that merely starts with the same characters is not mistaken for a child — the guard
 * only stays worth reading if it does not fire on directories that are fine.
 */
export function isUnderTempRoot(dir: string): boolean {
  const rel = path.relative(realpathish(tmpdir()), realpathish(nearestExisting(dir)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The closest ancestor of `dir` that exists — `dir` itself when it does.
 *
 * A path that does not exist cannot be realpath'd, so on a platform where the temp root
 * is a symlink (macOS: /var/folders behind /private/var) the guard was comparing an
 * unresolved path against a resolved one and quietly not firing (DE-7.1).
 */
function nearestExisting(dir: string): string {
  let at = dir;
  while (!existsSync(at)) {
    const parent = path.dirname(at);
    if (parent === at) return at;
    at = parent;
  }
  return at;
}

/** realpath where possible; the literal path where it does not resolve. */
function realpathish(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
