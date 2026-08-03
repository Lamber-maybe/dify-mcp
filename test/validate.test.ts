import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateGraph, type Graph, type Issue } from "../src/graph/validate.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string): Graph => JSON.parse(fs.readFileSync(path.join(dir, "fixtures", name), "utf8")) as Graph;
const codes = (issues: Issue[]): string[] => issues.filter((i) => i.level === "error").map((i) => i.code);

test("valid fixture produces no error-level issues", () => {
  const issues = validateGraph(load("valid.json"));
  assert.deepEqual(codes(issues), []);
});

test("invalid fixture detects bad ref, forward ref, cycle, unreachable", () => {
  const got = new Set(codes(validateGraph(load("invalid.json"))));
  assert.ok(got.has("BAD_VAR_REF"), "expected BAD_VAR_REF for {{#ghost.output#}}");
  assert.ok(got.has("CYCLE"), "expected CYCLE for llm1<->llm2");
  assert.ok(got.has("UNREACHABLE_NODE"), "expected UNREACHABLE_NODE for orphan1");
});

test("forward reference to a downstream node is flagged", () => {
  const graph: Graph = {
    nodes: [
      { id: "s", data: { type: "start", variables: [] } },
      { id: "a", data: { type: "llm", model: {}, prompt_template: [{ role: "user", text: "{{#b.text#" + "}}" }] } },
      { id: "b", data: { type: "llm", model: {}, prompt_template: [{ role: "user", text: "ok" }] } },
      { id: "e", data: { type: "end", outputs: [] } },
    ],
    edges: [
      { source: "s", target: "a" },
      { source: "a", target: "b" },
      { source: "b", target: "e" },
    ],
  };
  assert.ok(codes(validateGraph(graph)).includes("FORWARD_VAR_REF"));
});

test("missing start node is an error", () => {
  const graph: Graph = {
    nodes: [{ id: "a", data: { type: "llm", model: {}, prompt_template: [] } }],
    edges: [],
  };
  assert.ok(codes(validateGraph(graph)).includes("MISSING_START"));
});

test("missing required field per node type", () => {
  const graph: Graph = {
    nodes: [
      { id: "s", data: { type: "start", variables: [] } },
      { id: "c", data: { type: "code", code_language: "python3" } },
    ],
    edges: [{ source: "s", target: "c" }],
  };
  const got = codes(validateGraph(graph));
  assert.ok(got.includes("MISSING_REQUIRED_FIELD"));
});

test("sys and env references are not treated as node refs", () => {
  const graph: Graph = {
    nodes: [
      { id: "s", data: { type: "start", variables: [] } },
      { id: "a", data: { type: "answer", answer: "{{#sys.query#}} {{#env.API_BASE#}}" } },
    ],
    edges: [{ source: "s", target: "a" }],
  };
  assert.deepEqual(codes(validateGraph(graph)), []);
});

test("all example templates in examples/ produce no error-level issues", () => {
  const examplesDir = path.join(dir, "..", "examples");
  const files = ["minimal-workflow.json", "llm-workflow.json", "rag-workflow.json"];

  for (const file of files) {
    const graph: Graph = JSON.parse(fs.readFileSync(path.join(examplesDir, file), "utf8"));
    const issues = validateGraph(graph);
    assert.deepEqual(codes(issues), [], `Expected no error issues in ${file}, got: ${JSON.stringify(issues)}`);
  }
});

