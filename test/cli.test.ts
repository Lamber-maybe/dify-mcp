import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlags } from "../src/cli.ts";

test("parseFlags handles positionals, values, =values, booleans, repeats", () => {
  const { positional, flags } = parseFlags([
    "wf", "run", "app-1",
    "--input", "a=1", "--input", "b=2",
    "--yes", "--graph=test/fixtures/valid.json", "-o", "json",
  ]);
  assert.deepEqual(positional, ["wf", "run", "app-1"]);
  assert.deepEqual(flags.input, ["a=1", "b=2"]);
  assert.equal(flags.yes, true);
  assert.equal(flags.graph, "test/fixtures/valid.json");
});
