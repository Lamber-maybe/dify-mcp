import { test } from "node:test";
import assert from "node:assert/strict";
import { EXIT, err, ok, toYaml } from "../src/core/contract.ts";

test("ok/err contract shapes", () => {
  assert.deepEqual(ok({ a: 1 }), { ok: true, data: { a: 1 } });
  const e = err("NOT_FOUND", "nope");
  assert.equal(e.ok, false);
  if (!e.ok) {
    assert.equal(e.error.code, "NOT_FOUND");
    assert.equal(e.error.retryable, false);
  }
});

test("every error code has a unique-ish exit code", () => {
  for (const code of ["USAGE_ERROR", "AUTH_REQUIRED", "CONFIRM_REQUIRED", "VALIDATION_FAILED", "RBAC_DENIED", "NOT_FOUND", "DSL_VERSION_MISMATCH", "RATE_LIMITED", "SERVER_ERROR", "NETWORK_ERROR"] as const) {
    assert.equal(typeof EXIT[code], "number");
    assert.ok(EXIT[code] > 0);
  }
  assert.equal(EXIT.OK, 0);
});

test("toYaml renders nested structures", () => {
  const y = toYaml({ ok: true, data: { items: [{ id: 1, name: "x" }], note: null } });
  assert.match(y, /ok: true/);
  assert.match(y, /- id: 1/);
  assert.match(y, /name: x/);
});
