import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlags, resolveConsoleLoginCredentials } from "../src/cli.ts";

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

test("console login credentials prefer flags and fall back to environment", () => {
  assert.deepEqual(
    resolveConsoleLoginCredentials({}, {
      DIFY_CONSOLE_EMAIL: "bot@example.com",
      DIFY_CONSOLE_PASSWORD: "from-env",
    }),
    { email: "bot@example.com", password: "from-env" },
  );
  assert.deepEqual(
    resolveConsoleLoginCredentials(
      { email: "flag@example.com", password: "from-flags" },
      { DIFY_CONSOLE_EMAIL: "env@example.com", DIFY_CONSOLE_PASSWORD: "from-env" },
    ),
    { email: "flag@example.com", password: "from-flags" },
  );
});
