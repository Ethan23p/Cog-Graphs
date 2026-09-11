import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { makeOrdinarySandbox, runCli, spawnGraph, writeRaw } from "./helpers";
import { EXIT } from "./contract";

// DE-5.1 (minted 2026-09-11, found while ratifying the items.yml shape) — a flag that
// takes a file documents that file in `--help`, as a sample the command accepts verbatim.
//
// DE-5 asks every command's help to name its flags and carry a runnable example, against
// the doc's bar that an agent "with zero priming" reaches fluency from the CLI alone. Two
// flags take a file rather than a value, `initialize --profile` and `import --from`, and
// an example that names a file whose contents the agent has to invent is only half
// runnable. On 2026-09-11 neither command's help, nor the primer, nor the overview showed
// what goes in either file. An agent could learn the items shape only by guessing or by
// failing, and RU-6's whole flow runs through that file.
//
// The sample is asserted by round trip rather than by content, so help cannot drift from
// the parser: whatever it shows is, by construction, what the command takes.
describe("DE-5.1 — a file-taking flag documents its file, and the sample is accepted", () => {
  test("initialize --profile: the documented profile initializes a graph", () => {
    const cwd = makeOrdinarySandbox();
    const help = JSON.parse(runCli(["initialize", "--help"], { cwd }).stdout);
    const sample = help.files?.["--profile"];
    expect(typeof sample).toBe("string");

    const file = path.join(cwd, "profile.yml");
    writeRaw(file, sample);
    const r = runCli(["initialize", "--profile", file], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
  });

  test("import --from: the documented items file ingests every record it shows", () => {
    const g = spawnGraph({ namespace: "de51" });
    const help = JSON.parse(runCli(["import", "--help"], { cwd: g.cwd }).stdout);
    const sample = help.files?.["--from"];
    expect(typeof sample).toBe("string");

    const file = path.join(g.cwd, "items.yml");
    writeRaw(file, sample);
    const r = runCli(["import", "--graph", g.namespace, "--from", file], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    // More than one record, cleanly. A sample of one does not show an agent that the file
    // is a list, and a sample that partly fails teaches the wrong shape.
    expect(JSON.parse(r.stdout).ingested).toBeGreaterThan(1);
    // And every record lands with its attributes. A sample whose shape the parser only
    // half-understands (attributes written flat beside the entity, say) can still ingest
    // its entities cleanly, and would teach an agent a shape that silently drops data.
    const items = JSON.parse(runCli(["query", "--graph", g.namespace], { cwd: g.cwd }).stdout)
      .items as { entity: string; attributes: Record<string, string> }[];
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) {
      expect(Object.keys(item.attributes).length).toBeGreaterThan(0);
    }
  });
});
