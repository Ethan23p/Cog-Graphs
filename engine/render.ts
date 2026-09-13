// Every face the engine renders: the JSON answer, its --pretty form, and the sidecar.
//
// They live together because they share one hazard. Each interpolates data the engine was
// handed, and hardening one face does not harden another: DE-19.7 escaped the sidecar, then
// DE-19.8 added --pretty unguarded and the same forgery worked again (DE-19.7.1). All of it
// is pure — data in, text out.

/**
 * One line, always.
 *
 * The sidecar is interpolated Markdown, so any datum that can introduce a line can
 * introduce a *heading* — an entity named "Sword\n\n### Shield" renders an entity that
 * does not exist (DE-19.7). The database is the authority and keeps what it was given,
 * which is exactly why the rendering is where this is dealt with: the fix must not reach
 * back and edit the User's data.
 *
 * Line breaks become a visible `\n`, so the value stays legible and stays one line.
 * Nothing else is touched — backslashes especially are left alone, because `C:\games` is
 * an ordinary value in this domain and doubling it would make every sidecar pay for the
 * rare case.
 */
export function inline(value: string): string {
  return value.replace(/\r\n|\r|\n/g, "\\n");
}

// ---------------------------------------------------------------------------------------
// Answers

/** A success, as it goes to stdout. JSON by default; the Operator is an agent. */
export function renderAnswer(payload: Record<string, unknown>, pretty: boolean): string {
  return pretty ? `${prettyText(payload)}\n` : `${JSON.stringify(payload)}\n`;
}

/**
 * A failure, as it goes to stderr. JSON, so an Operator piping stdout into a parser never
 * has a failure corrupt the parse.
 *
 * --pretty covers failures too: an Operator who asked for readable output asked about the
 * whole surface. Only the braces go — what went wrong and what to do next survive the change
 * of form (IN-11, DE-19.8).
 */
export function renderError(
  error: { code: string; message: string; next_step: string; detail: Record<string, unknown> },
  pretty: boolean,
): string {
  const { code, message, next_step, detail } = error;
  return pretty
    ? `${prettyText({ error: code, message, next_step, ...detail })}\n`
    : `${JSON.stringify({ code, message, next_step, ...detail })}\n`;
}

/**
 * The human-readable form (DE-19.8).
 *
 * The renderer is generic — it walks the payload rather than knowing any command's shape —
 * so a command added later is readable without anyone remembering to teach this about it.
 *
 * The case it exists for is prose. `introduce --interface-skill` is the whole primer, and
 * as JSON it arrives as a single enormous line with every paragraph break spelled
 * backslash-n. Multi-line strings are therefore reflowed as real lines rather than
 * quoted, which is the one thing JSON structurally cannot do.
 */
function prettyText(payload: Record<string, unknown>): string {
  return prettyLines(payload, "").join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Reflow a multi-line string as real lines, or fold it onto one?
 *
 * Both, depending on whose text it is. The top-level fields of a payload are written by
 * the engine — the primer, the introduction, a summary — and reflowing them is the entire
 * reason `--pretty` exists (DE-19.8). Everything nested below that is the Operator's own
 * data: an entity, an attribute, a value. Reflowing *that* lets it forge payload fields,
 * because an attribute value of "count: 999" rendered on its own line is indistinguishable
 * from a field the payload actually has (DE-19.7.1).
 *
 * The depth is the line, and it is a real one rather than a convenient one: it is exactly
 * the boundary between text this program wrote and text it was handed.
 */
function prettyLines(value: unknown, indent: string, depth = 0): string[] {
  if (value === null || value === undefined) return [`${indent}—`];

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}(none)`];
    const out: string[] = [];
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        // A bullet on the item's first line, so the boundary between two items is
        // something the reader can see and count rather than infer from a blank line —
        // which vanishes exactly when an item has nothing in it (DE-19.8.2).
        const rendered = prettyLines(item, indent + "  ", depth + 1);
        if (rendered.length > 0) rendered[0] = `${indent}- ${rendered[0]!.trimStart()}`;
        out.push(...rendered, "");
      } else {
        out.push(`${indent}- ${depth === 0 ? String(item) : inline(String(item))}`);
      }
    }
    return out;
  }

  if (typeof value === "object") {
    const out: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Keys are snake_case in the payload because that is what a parser wants; a reader
      // wants words. The label is the only cosmetic liberty taken with the data.
      const label = key.replace(/_/g, " ");
      if (child !== null && typeof child === "object") {
        // Emptiness is a fact about the data, so it is rendered as one. A bare label with
        // nothing beneath it cannot be told apart from a renderer that stopped (DE-19.8.2).
        const rendered = prettyLines(child, indent + "  ", depth + 1);
        if (rendered.length === 0) out.push(`${indent}${label}: (none)`);
        else out.push(`${indent}${label}:`, ...rendered, "");
      } else if (typeof child === "string" && child.includes("\n") && depth > 0) {
        out.push(`${indent}${label}: ${inline(child)}`);
      } else if (typeof child === "string" && child.includes("\n")) {
        out.push(`${indent}${label}:`, "");
        for (const line of child.split("\n")) out.push(line ? `${indent}  ${line}` : "");
        out.push("");
      } else {
        out.push(`${indent}${label}: ${String(child)}`);
      }
    }
    return out;
  }

  return [`${indent}${String(value)}`];
}

// ---------------------------------------------------------------------------------------
// The sidecar

export interface SidecarContents {
  namespace: string;
  /** The `.sqlite` beside it, by file name. */
  databaseFile: string;
  profile: { field: string; value: string }[];
  convention: string[];
  entities: { name: string; attributes: { attribute: string; value: string }[] }[];
}

/**
 * Render the inspectable face.
 *
 * It is *derived*: no content is ever taken from it, so anything only recorded here is not
 * recorded. And it is *for an observer* — the person or agent who found a `.sqlite` in a
 * directory and has no idea what it is — so it leads with what the graph is for and how to
 * work it, and the item listing comes after.
 */
export function renderSidecar(graph: SidecarContents): string {
  const { namespace, databaseFile, profile, convention, entities } = graph;
  const lines: string[] = [];
  lines.push(`# ${inline(namespace)}`, "");
  lines.push(
    "> Derived file — do not edit. The engine rewrites it whenever the graph changes,",
    `> and never takes anything back from it. Everything real lives in \`${databaseFile}\`.`,
    "",
  );
  lines.push(
    "This is a **Cog Graph**: a persistent store of entities and the attribute/value",
    "pairs recorded about them. It is meant to be worked through the `cog-graphs` CLI —",
    "`cog-graphs introduce --graph " + inline(namespace) + "` is the way in, and",
    "`cog-graphs introduce --interface-skill` is the full primer.",
    "",
  );

  lines.push("## Profile", "");
  for (const { field, value } of profile) lines.push(`- **${inline(field)}**: ${inline(value)}`);
  lines.push("");

  lines.push("## Convention", "");
  lines.push("The expectations this graph keeps about its own shape. Amended as the data changes.", "");
  if (convention.length === 0) lines.push("_None recorded._", "");
  else for (const text of convention) lines.push(`- ${inline(text)}`, "");

  lines.push("## Contents", "");
  if (entities.length === 0) {
    lines.push("_Empty — nothing has been added yet._", "");
  } else {
    lines.push(`${entities.length} ${entities.length === 1 ? "entity" : "entities"}.`, "");
    for (const entity of entities) {
      lines.push(`### ${inline(entity.name)}`, "");
      if (entity.attributes.length === 0) lines.push("_No attributes recorded._", "");
      else {
        for (const a of entity.attributes) lines.push(`- **${inline(a.attribute)}**: ${inline(a.value)}`);
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
