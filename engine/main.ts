#!/usr/bin/env bun
// Cog-Graphs engine — CLI entry point.
//
// The CLI is the UX and its user is an AI agent, so every answer is JSON on stdout and
// the process boundary is the whole contract.

const argv = process.argv.slice(2);
const command = argv[0];

const SYSTEM_INTRODUCTION = [
  "Cog-Graphs spawns and manipulates persistent structured stores — a Cog Graph is an",
  "EAV store you create per use-case and keep in your working directory.",
  "",
  "There is no Cog Graph here yet. To make one, write a profile as a small .yml file",
  "(namespace, use-pattern, description, and a seed convention), then run:",
  "  cog-graphs initialize --profile <file.yml>",
].join("\n");

function succeed(payload: Record<string, unknown>): never {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(0);
}

if (command === "introduce") {
  succeed({ scope: "system", introduction: SYSTEM_INTRODUCTION });
}

process.exit(1);
