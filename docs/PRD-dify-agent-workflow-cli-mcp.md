# PRD: Dify Agent Workflow Authoring — CLI + MCP Server

> Status: Draft v2 (post-audit revision) · Target: one tool that lets **any** AI agent — Claude Code, Codex, Gemini CLI, Cursor, Cline, or a plain shell — do **everything a Dify UI user can do**: create, edit, and test workflows.
> v2 changes: audit findings F1–F10 folded in (auth gate, OpenAPI/Console split, provider+plugin tools, graphon node discovery, DSL 0.7.0 pin, SSE, threat-model gaps, Test Plan); new §7.2 agent-agnostic design.
> Grounded in: `langgenius/dify` Console + OpenAPI controllers, `graphon==0.6.0` engine, `difyctl`, and third-party work (`Akabane71/dify-workflow-cli`, `linhai0872/dify-dsl-pipe`, `YanxingLiu/dify-mcp-server`).

---

## 1. Summary

Build one TypeScript codebase that ships as **two faces of the same tool functions** — a CLI (`difywf`) that any agent can drive via shell, and an MCP server (stdio + Streamable HTTP) that MCP hosts can attach — both over the same typed client. API substrate is split by stability: the official **`/openapi/v1`** surface (device-token auth, generated types) wherever it exists, and the **Console API** only for what is console-only (app create, draft sync, publish, node-run, features, versions, triggers, provider/plugin config). Agents get full workflow lifecycle: create → author → validate → test → publish → iterate, plus import/export, triggers, providers/plugins, and observability.

## 2. Contacts

| Role | Owner | Notes |
|------|-------|-------|
| Product / PM | (you) | Scope, prioritization, validation |
| Eng lead | TBD | Client + MCP/CLI layers |
| Security reviewer | TBD | Threat model sign-off (§9) |

## 3. Background

Dify's UI editor is the only first-class way to author workflows. Underneath sit two programmatic surfaces:

- **`/openapi/v1`** — official external API: device-flow OAuth (RFC 8628, `oauth/device/code|token`), apps list/describe, run/stop, SSE task events, DSL import/export/confirm/deps-check, workspaces/members, files, HITL forms. Proven consumable headlessly — `difyctl` uses exactly this surface with generated `@dify/contracts/api/openapi` types.
- **`/console/api/*`** — internal UI backend, which alone holds the authoring loop: `POST /apps/{id}/workflows/draft` (graph sync), `default-workflow-block-configs` (per-node-type schemas), publish, node-run, features, versions, triggers, statistics, and workspace model-provider/plugin configuration.

Existing tools leave the authoring niche empty: Dify's own MCP server and `YanxingLiu`/`gotoolkits` are run-only; `dify-dsl-pipe` is app-lifecycle-only; `Akabane71/dify-workflow-cli` does offline DSL authoring + validation but talks to no API and exposes no MCP. **Why now:** node schemas are machine-discoverable at runtime (`default-workflow-block-configs`), MCP is mainstream in every major coding agent, and a CLI twin makes the same capability reachable by agents that don't speak MCP.

## 4. Objective

Let any agent fully operate a Dify workspace's workflow lifecycle without the web UI, identically across hosts, with guardrails a human can trust.

**Key Results (SMART):**
- KR1: ≥ 90% of the §7.4 capability-matrix rows (the inventory = the denominator) implemented as idempotent tools passing contract tests against a Dify v1.x reference instance.
- KR2: From a natural-language spec to a **published, test-passing** workflow in one session with ≤ 2 human confirm gates — reproduced on ≥ 3 hosts (Claude Code, Codex, Gemini CLI) via both CLI and MCP paths.
- KR3: Round-trip parity — `export → mutate → import` and `sync-draft → publish` produce identical published graphs (diff = ∅).
- KR4: Zero plaintext-token storage; all destructive ops require explicit confirm (non-interactive, parameter-based); append-only audit log of every agent action.
- KR5: CLI and MCP share one codebase; a cross-host parity suite proves identical JSON output for the same operation on both surfaces.
- KR6 (gate): Phase 0 exits only after a headless credential is demonstrated against `GET /console/api/apps/{id}/workflows/draft` (§7.7).

## 5. Market Segments

- **Agent-assisted app builders** (primary): engineers/PMs using Claude Code, Codex, Gemini CLI, Cursor etc. who want their agent to scaffold + iterate Dify apps. Job: "describe it, get a working published workflow."
- **Platform/DevOps teams**: templatize, migrate, version-control Dify apps across instances from CI (shell-driven, no MCP needed).
- **Agent framework integrators**: Dify as a build target for other agents; need stable JSON I/O, not host-specific features.
- **Constraints**: Dify Cloud and self-hosted v1.x; must respect RBAC; must not require UI sessions; must not assume any single agent host.

## 6. Value Propositions

| Job / Pain | Gain | Better than |
|---|---|---|
| Authoring only via click UI | Agent builds/edits graphs via tools; humans review diffs | `difyctl`, `YanxingLiu` MCP (run-only) |
| Agent lock-in / host-specific tooling | Same tool set over CLI (universal) and MCP (convenience); zero host-specific MCP features | single-host MCP wrappers |
| No validation before save | 3-layer validate (node schema → var refs → connectivity + cycles) pre-sync | `Akabane71` (offline only) |
| Manual provider/plugin setup blocks test runs | Provider + plugin tools in the same loop | all existing tools (none cover it) |
| Manual plugin-dependency resolution on import | Agent runs `dependencies:check` + `confirm` automatically | raw DSL import |
| Drift between instances | Export/import/migrate with version adaptation (DSL 0.7.0 / graphon 0.6.0 pinned) | `dify-dsl-pipe` (lifecycle only) |
| No audit trail for agent actions | Per-action audit log + confirm gates | UI (no agent audit) |

## 7. Solution

### 7.1 Architecture

```mermaid
flowchart TB
  subgraph Hosts[Agent hosts]
    A1[Claude Code]
    A2[Codex]
    A3[Gemini CLI]
    A4[Cursor / Cline / other MCP hosts]
    A5[Any shell-capable agent]
  end
  subgraph Tool[This Project — single TS codebase]
    direction TB
    CLI[CLI  difywf  - universal surface]
    MCP[MCP Server  stdio + Streamable HTTP  - convenience surface]
    TOOLS[Tool impls  pure async fns  single source of truth]
    GUIDE[Agent onboarding  guide + schema tools]
    VALID[Graph model + validators]
    SAFETY[Safety  dry-run, diff, confirm params, audit]
    CLIENT[API clients  openapi typed + console hand-typed]
    AUTH[Auth adapter  device-flow / OAuth / session-JWT]
  end
  subgraph Dify[Dify Platform]
    OPENAPI[/openapi/v1  official external API]
    CONSOLE[/console/api  internal UI backend]
  end
  A1 & A2 & A3 & A4 -->|MCP stdio / HTTP| MCP
  A1 & A2 & A3 & A5 -->|shell| CLI
  CLI --> TOOLS
  MCP --> TOOLS
  TOOLS --> GUIDE
  TOOLS --> VALID
  TOOLS --> SAFETY
  SAFETY --> CLIENT
  CLIENT --> AUTH
  CLIENT -->|preferred, stable| OPENAPI
  CLIENT -->|authoring only| CONSOLE
```

**Layer contracts:**
- `TOOLS` are pure async functions `(opts, deps) => result`. CLI and MCP are thin adapters; no business logic in either surface (difyctl `run.ts` pattern).
- `CLIENT` is two clients: OpenAPI resources generated from `@dify/contracts/api/openapi` types; Console resources hand-typed per endpoint (internal surface, version-adapted).
- `GUIDE` gives agents self-onboarding: playbook text + per-node-type schema fetch (progressive disclosure, token-efficient on any model).
- `SAFETY` wraps every mutation: dry-run, diff-before-sync, confirm **parameters** (never interactive prompts), audit-log append.
- `AUTH` is an adapter isolating credential acquisition/storage (decouples us from difyctl's alpha `hosts.yml` format).

**ADRs:**
- **ADR-1 — TypeScript/Node, single codebase.** MCP SDK is TS-first; reuse difyctl patterns + contracts types; one binary ships CLI + MCP.
- **ADR-2 — Dual substrate: OpenAPI preferred, Console for authoring only.** Stability + generated types on the official surface; console contained behind the version adapter. (Supersedes v1's console-everything assumption — audit F2.)
- **ADR-3 — CLI is the universal substrate; MCP is a projection.** Any shell-capable agent gets full capability without MCP; MCP hosts get the same tools with zero host-specific features (§7.2).
- **ADR-4 — Dynamic node schema via `default-workflow-block-configs`.** Classic node implementations live in the external `graphon==0.6.0` pip package (api/pyproject.toml:48), so runtime schema discovery is the only durable path; completeness verified at Phase-0 gate, supplemented from graphon source where gaps exist.
- **ADR-5 — Auth adapter with spike-chosen mechanism.** Candidates in order: (a) device token accepted on console endpoints, (b) console OAuth flow (`console/auth/oauth_server.py`), (c) session JWT from email/password login (self-hosted fallback). Chosen by Phase-0 spike (§7.7).
- **ADR-6 — No interactive prompts anywhere.** Confirm gates are flags/parameters/policies; agents cannot reliably answer elicitation prompts.

### 7.2 Agent-Agnostic Design (hard requirement)

The tool must work identically for Claude Code, Codex, Gemini CLI, Cursor, Cline, and shell-only agents.

- **Two equivalent surfaces, one implementation.** Every operation exists as both a `difywf` command and an MCP tool, generated from the same tool registry — parity is structural, not maintained by hand. Shell-capable agents (Codex, Gemini CLI, Claude Code) can drive the CLI directly; MCP hosts attach the server.
- **stdio is the baseline MCP transport** (supported by Claude Code, Codex, Gemini CLI, Cursor, Cline). Streamable HTTP is optional, auth-token protected, localhost-bound by default.
- **Stable MCP feature subset only:** `tools` with JSON-Schema inputs + structured JSON text output; optional `resources` for the guide/schema. **Never** elicitation, sampling, or roots — unevenly supported across hosts, and confirm flows must not depend on them (ADR-6).
- **Deterministic output contract (both surfaces):** `{ "ok": bool, "data": ..., "error": { "code", "message", "retryable" } }`; stable error codes (e.g. `AUTH_EXPIRED`, `RBAC_DENIED`, `DSL_VERSION_MISMATCH`, `VALIDATION_FAILED`, `CONFIRM_REQUIRED`); CLI `-o json|yaml|text` with stable exit codes (`0` ok, `2` usage, `3` auth, `4` confirm-required, `5` server). Agents parse, never scrape human text.
- **Self-onboarding for any agent:** `dify.agent.guide` tool / `difywf agent guide` command returns the authoring playbook (mode list, node-type list, DSL/graphon versions, golden-path recipe, error-code table). `dify.workflow.node_defaults` returns one node type's schema on demand — progressive disclosure keeps context small on any model.
- **Idempotent + retryable:** sync is hash-checked (server returns `DraftWorkflowNotSync` on stale hash — surfaced as `retryable: true` with a re-fetch hint); all reads safe to repeat; mutations carry `--dry-run` and `--diff`.
- **Zero interactive input:** every prompt has a flag/env equivalent (`--yes`, `--from-file -`, `DIFY_*` env vars). Headless CI is a first-class case.
- **Host setup is one line each** (Appendix C); the same binary serves all.

### 7.3 API Surface Strategy (audit F2)

| Use OpenAPI `/openapi/v1` for (stable, typed, device-token) | Use Console `/console/api` only for (internal, adapted) |
|---|---|
| apps list / describe (`GET /apps`, `GET /apps/{id}`) | app **create / update / delete / copy / convert** (OpenAPI has no POST /apps) |
| run + stop (`POST /apps/{id}:run`, `.../tasks/{tid}:stop`) | **draft get/sync**, **node defaults**, **publish**, **node-run** |
| task events SSE (`GET /apps/{id}/tasks/{tid}/events`) | features, env/conversation variables, versions (list/restore/delete) |
| DSL import + confirm + deps-check, DSL export (`app_dsl.py`) | triggers, statistics, runs history/node-executions |
| workspaces + members, file upload, HITL forms | **model providers, plugins, tool providers, load balancing** |
| device-flow OAuth (`oauth/device/*`) | (auth fallback per ADR-5) |

### 7.4 Capability Matrix (UI capability → endpoint → tool/command → priority)

Surface: **O** = OpenAPI, **C** = Console. Priorities: P0 core loop · P1 lifecycle/integration · P2 observability/extras.

| UI capability | Surface | Endpoint | Tool / Command | Pri |
|---|---|---|---|---|
| List / describe apps | O | `GET /apps`, `GET /apps/{id}` | `app.list` `app.get` | P0 |
| Create app (5 modes: chat, agent-chat, advanced-chat, workflow, completion) | C | `POST /apps` | `app.create` | P0 |
| Update / delete app | C | `PUT/DELETE /apps/{id}` | `app.update` `app.delete` | P0 |
| Rename / icon / copy / convert mode | C | `/apps/{id}/name`, `/icon`, `/copy`, `/convert-to-workflow` | `app.rename` `app.set_icon` `app.copy` `app.convert` | P1 |
| Get draft graph | C | `GET /apps/{id}/workflows/draft` | `workflow.get_draft` | P0 |
| Sync draft (save graph) | C | `POST /apps/{id}/workflows/draft` | `workflow.sync_draft` | P0 |
| Node default schemas | C | `GET /apps/{id}/workflows/default-workflow-block-configs[/{type}]` | `workflow.node_defaults` | P0 |
| Get/set features | C | `GET/POST /apps/{id}/workflows/draft/features` | `workflow.get_features` `workflow.set_features` | P1 |
| Env / conversation variables | C | draft-sync payload + `workflow_draft_variable` routes | `workflow.set_env_var` `workflow.set_conv_var` | P1 |
| Run draft (test, SSE) | C | `POST /apps/{id}/workflows/draft/run` | `workflow.run_draft` | P0 |
| Run published app (SSE) | O | `POST /apps/{id}:run` | `workflow.run` | P0 |
| Task events stream | O | `GET /apps/{id}/tasks/{tid}/events` | `workflow.events` | P0 |
| Run single node / iteration / loop | C | `POST .../draft/(nodes\|iteration/nodes\|loop/nodes)/{nid}/run` | `workflow.run_node` | P0 |
| Stop task | O | `POST /apps/{id}/tasks/{tid}:stop` | `workflow.stop` | P0 |
| Node last-run result | C | `GET .../draft/nodes/{nid}/last-run` | `workflow.node_last_run` | P1 |
| HITL form preview/submit | C+O | console draft routes + `human-input-forms/{token}[:submit]` | `workflow.hitl_preview` `workflow.hitl_submit` | P1 |
| Publish | C | `POST /apps/{id}/workflows/publish` | `workflow.publish` | P0 |
| Versions list / get / restore / delete | C | `GET /apps/{id}/workflows`, `GET/POST/DELETE .../workflows/{wid}` | `workflow.list_versions` `get_version` `restore` `delete_version` | P1 |
| Import DSL (2-step) | O | `POST /workspaces/{wid}/apps/imports` → `.../imports/{iid}:confirm` | `app.import` (auto deps-check + confirm flow) | P1 |
| Export DSL | O | `GET /apps/{id}/dsl` | `app.export` | P1 |
| Check dependencies | O | `POST /apps/{id}/dependencies:check` | `app.check_deps` | P1 |
| **Model providers list/configure** | C | `console/workspace/model_providers.py`, `models.py` | `provider.list` `provider.set_credentials` `provider.models` | **P0** (test runs need them) |
| **Plugins install/list** | C | `console/workspace/plugin.py` | `plugin.list` `plugin.install` `plugin.get` | **P1** (import deps need them) |
| Tool providers / load balancing | C | `tool_providers.py`, `load_balancing_config.py` | `provider.tools` `provider.lb_*` | P2 |
| Triggers (webhook/schedule/enable) | C | `/apps/{id}/triggers`, `/trigger-enable`, `/workflows/triggers/webhook` | `trigger.list` `create` `enable` `webhook` | P1 |
| Trigger run / run-all | C | `.../draft/trigger/run`, `/run-all` | `workflow.trigger_run` `trigger_run_all` | P1 |
| Runs history / node executions | C | `GET /apps/{id}/workflow-runs[/{rid}[/node-executions]]` | `runs.list` `runs.get` `runs.node_executions` | P1 |
| Export run | C | `GET /apps/{id}/workflow-runs/{rid}/export` | `runs.export` | P2 |
| Statistics | C | `/apps/{id}/workflow/statistics/*` | `stats.*` | P2 |
| Workspaces / members | O | `/workspaces[...]` | `workspace.list` `get` `switch` `members` | P1 |
| File upload (for runs) | O | `POST /apps/{id}/files` | `file.upload` | P1 |
| Comments / annotations | C | `workflow_comment`, `/apps/{id}/annotations*` | `comment.*` `annotation.*` | P2 |
| Audio STT/TTS | C | `/apps/{id}/audio-to-text`, `/text-to-audio*` | `audio.transcribe` `synthesize` | P2 |
| Agent config / drive / sandbox | C | `agent_config_inspector.py`, `agent_drive_inspector.py`, `agent_app_sandbox.py` | `agent.*` | P2 |
| Explore templates / snippets / RAG pipelines / run archive / online users | C | `explore/`, `snippet_workflow*`, `datasets/rag_pipeline/*`, `workflow_run_archive`, socketio | `explore.*` `snippet.*` `rag.*` `archive.*` `stats.online_users` | P2 |

### 7.5 MCP Tool Catalog (P0 detail)

Namespace `dify` · structured JSON out · error codes per §7.2. CLI mirrors 1:1.

- `dify.agent.guide` — `{section?}` → playbook text (versions, node types, golden path, error table)
- `dify.app.list` — `{workspace?, mode?, page?}` · `dify.app.get` — `{app_id}`
- `dify.app.create` — `{mode, name, description?, icon_type?, icon?, icon_background?}` → `{app_id}`
- `dify.app.update` / `dify.app.delete` (confirm param)
- `dify.workflow.get_draft` — `{app_id}` → `{graph, features, environment_variables, conversation_variables, hash}`
- `dify.workflow.node_defaults` — `{app_id, node_type}` → that type's `data` schema (per-type, progressive disclosure)
- `dify.workflow.validate` — `{graph}` → issues[] (pure, offline; called before every sync)
- `dify.workflow.sync_draft` — `{app_id, graph, features?, environment_variables?, conversation_variables?, hash, dry_run?, diff?}` → `{hash, updated_at}`; stale hash → `retryable` error + fresh draft
- `dify.workflow.run_draft` — `{app_id, inputs, wait?}` → result or `{task_id}` (+ `dify.workflow.events` to stream)
- `dify.workflow.run` — `{app_id, inputs, wait?}` (published, OpenAPI)
- `dify.workflow.events` — `{app_id, task_id}` → SSE-bridged event list/stream
- `dify.workflow.run_node` — `{app_id, node_id, inputs, mode?: node|iteration|loop}`
- `dify.workflow.stop` — `{app_id, task_id}`
- `dify.workflow.publish` — `{app_id, note?, confirm: true}` (confirm param required)
- `dify.provider.list` — `{}` → configured providers · `dify.provider.set_credentials` — `{provider, credentials, confirm: true}` · `dify.provider.models` — `{provider}`

P1/P2 follow the matrix; every mutation takes `confirm` / `dry_run` params instead of prompts.

### 7.6 CLI Command Catalog (P0)

```
difywf agent guide [section]
difywf app list|get|create|update|delete ...
difywf wf draft get <app-id> [-o file]
difywf wf draft sync <app-id> --graph <file|-> [--features f] [--dry-run] [--diff] [--yes]
difywf wf node defaults <app-id> <node-type>
difywf wf validate --graph <file>
difywf wf test <app-id> --input k=v [--wait]      # draft run
difywf wf run <app-id> --input k=v [--wait]       # published
difywf wf events <app-id> <task-id>
difywf wf node run <app-id> <node-id> --input k=v
difywf wf stop <app-id> <task-id>
difywf wf publish <app-id> [--note] [--yes]
difywf provider list|set-credentials|models ...
```
Global: `-o json|yaml|text`, `--dry-run`, `--diff`, `--yes`, `DIFY_*` env equivalents for every flag.

### 7.7 Auth & Version Adaptation

- **Phase-0 spike (exit gate KR6):** prove one headless credential against `GET /console/api/apps/{id}/workflows/draft`. Candidate order (ADR-5): (a) device token on console, (b) console OAuth (`console/auth/oauth_server.py`), (c) email/password session JWT (self-hosted fallback). Record result in ADR-5 before any build.
- **OpenAPI side is proven:** device flow (`POST /openapi/v1/oauth/device/code|token`) is exactly what difyctl uses; reuse the flow, not difyctl's storage — auth adapter owns keychain storage (macOS Keychain / libsecret / encrypted-file fallback), never plaintext (F9 isolation).
- **Non-interactive paths:** `--token` / `DIFY_CONSOLE_TOKEN` / `DIFY_OPENAPI_TOKEN` for CI; device flow for humans.
- **RBAC:** map required permissions per tool (`APP_VIEW_LAYOUT`, `APP_IMPORT_EXPORT_DSL`, provider/plugin perms); surface failures as `RBAC_DENIED` naming the missing permission.
- **Version adaptation:** pin `target_dsl_version = 0.7.0` (`CURRENT_APP_DSL_VERSION`, api/constants/dsl_version.py) and `graphon = 0.6.0`; adapter matrix Dify-version × DSL × graphon (Legacy 0.6–0.15.3 / Modern 1.0+ per dify-dsl-pipe's pattern); fail loudly as `DSL_VERSION_MISMATCH` on drift.

### 7.8 Validation & Safety

- **Pre-sync offline validation:** port `Akabane71`'s 3 layers — node `data` vs `default-workflow-block-configs` schema → variable references resolve → connectivity + cycle detection — plus Dify frontend `use-checklist.ts` pre-publish parity. Graph fixtures from `api/tests/fixtures/workflow/*.yml` as test corpus.
- **Confirm gates (parameter-based, ADR-6):** `publish`, `delete`, `delete_version`, `restore`, `import` confirm, `provider.set_credentials`, `trigger.enable`, and graphs containing **code nodes** (§9). Default deny; `--yes`/`confirm: true` per call; session-scoped trust optional.
- **Diff-before-mutate:** `sync_draft`, `publish`, `import` return structural diff in dry-run mode.
- **Audit log:** append-only JSONL `{ts, surface(cli|mcp), host_hint, tool, opts_hash, actor, result}` at `~/.difywf/audit.jsonl`.

### 7.9 Assumptions

- The F1 spike finds at least one viable headless console credential (highest-risk assumption; KR6 gates on it).
- `default-workflow-block-configs` covers all graphon node types' schemas; gaps supplementable from the graphon package source (verified at Phase-0 gate).
- OpenAPI surface remains stable across v1.x; Console internals may drift — contained by the version adapter.
- `code` node execution is sandboxed server-side; our policy layer still gates agent-authored code nodes.
- MCP hosts converge on the stable feature subset (tools + resources); no host needs elicitation/sampling for our flows.

## 8. Release / Roadmap

Relative timeframes; one engineer-equivalent.

**Phase 0 — Foundation + gates (~2–3 wks)**
TS scaffold; auth adapter + **F1 auth spike (gate)**; OpenAPI typed client from contracts; Console client skeleton (workflow read/write); graph model + validators seeded from `api/tests/fixtures/workflow/*.yml`; **node-schema completeness gate** (dump `default-workflow-block-configs`, diff against graphon node types); CI with local Dify docker smoke test.

**Phase 1 — P0 loop (~3–4 wks)**
CLI + MCP stdio from one registry: `agent.guide`, `app.{list,get,create,update,delete}`, `workflow.{get_draft,node_defaults,validate,sync_draft,run_draft,run,events,run_node,stop,publish}`, `provider.{list,set_credentials,models}`. Confirm params + audit log. Cross-host parity suite green. **MVP.**

**Phase 2 — P1 lifecycle + integration (~3–4 wks)**
Features + env/conv vars; versions; DSL import (deps-check → confirm) + export; `plugin.*`; triggers; workspaces/members; file upload; HITL forms; trigger-run; convert/copy/rename/icon. Streamable HTTP transport (auth-token, localhost default).

**Phase 3 — P2 observability + extras (~3–4 wks)**
Runs history/node-executions/export-run, statistics, comments, annotations, audio, snippets, RAG pipelines, explore, agent config/drive/sandbox, run archive, online users.

**Phase 4 — Hardening (~2 wks)**
Threat-model mitigations; cross-version matrix (0.15.x vs 1.x); docs incl. Appendix C host setup; packaging (npm, brew, `npx difywf`); OSS release.

## 9. Threat Model

**Assets:** OpenAPI device token + console credential (workspace-admin power), app configs, provider credentials, secrets in env/conversation vars and DSL exports, published app behavior, audit-log integrity, and — because agents execute code nodes — the Dify server's sandbox boundary.

**Trust boundaries:** (1) agent host (untrusted LLM output) ↔ difywf process; (2) difywf ↔ Dify APIs (network); (3) stdio MCP = local trust; Streamable HTTP = network trust (token + localhost-bind default); (4) Dify server-side sandbox (out of our control, policy-gated on our side).

**Attacker-controlled inputs:** agent-generated graph JSON / DSL YAML (prompt-injection vehicle); `--from-url` DSL; marketplace plugin identifiers; http-request node configs (SSRF); code-node source (server-side execution); provider credential values.

**Invariants:** graph acyclic + Start-connected; var refs resolve; node `data` conforms to fetched schema; no mutation without confirm param; tokens only in keychain/CI env, never logged or exported by default (`include_secret=false`, audit when overridden); audit append-only; workspace scope asserted per call.

**Failure modes → mitigations:**
- Token leak → keychain storage, log redaction, scoped tokens, `include_secret=false` default.
- SSRF (http-request nodes, `--from-url`) → URL host allowlist; warn on private-IP targets pre-publish.
- Destructive publish/delete → confirm params + dry-run diff.
- **Malicious code nodes authored by an injected agent** → code-node policy: `allow | confirm (default) | forbid`; forbid recommended for unattended CI.
- Plugin/dependency injection via import → `dependencies:check` always run; plugin list surfaced for confirm; no auto-install without explicit opt-in.
- Prompt injection steering the agent → validation rejects invalid graphs regardless of intent; audit log enables post-hoc review.
- DSL/graphon drift → version pins + `DSL_VERSION_MISMATCH` hard fail.
- CSRF (if console fallback is cookie-based) → bearer-only client design where possible; CSRF token handling contained in auth adapter.
- Cross-tenant access → workspace id resolved + asserted per call; negative test in §10.

## 10. Test Plan (audit F8)

- **Unit:** validators against real Dify fixtures (`api/tests/fixtures/workflow/*.yml`); output-contract shape; error-code mapping; version-adapter routing.
- **Contract (live Dify docker):** golden path — `app.create → node_defaults → validate → sync_draft → run_draft → publish → run` — plus provider credential setup; OpenAPI surface contract suite; RBAC-denied and stale-hash paths.
- **Round-trip parity (KR3):** export → mutate → import → diff = ∅; sync → publish → re-export → compare.
- **Agent-agnostic parity (KR2/KR5):** same scripted scenario via CLI in shell and via MCP stdio; headless host runs where supported (`claude -p`, `codex exec`, `gemini -p`); identical JSON asserted across surfaces.
- **Cross-version:** Dify 0.15.x vs 1.x; DSL 0.7.0; graphon 0.6.0.
- **Security:** cross-tenant deny; `include_secret=false` default; confirm-gate enforcement (publish without confirm → `CONFIRM_REQUIRED`); code-node policy (forbid/confirm); token never in audit/log output.

## 11. Risks & Open Questions

1. **F1 auth spike (gate).** If no headless console credential works, fallback scope = OpenAPI-only product (list/run/DSL import-export — still useful, but no granular authoring). Decide go/no-go at Phase-0 exit.
2. **Console API instability** (internal, undocumented): mitigated by adapter + contract tests pinning behavior per Dify version; budget maintenance per Dify release.
3. **graphon schema gaps:** if `default-workflow-block-configs` under-describes plugin-contributed nodes, supplement from graphon source; track upstream.
4. **SSE over MCP stdio:** events are delivered as chunked tool results / progress notifications; Streamable HTTP streams natively. Parity suite covers both.
5. **Provider credential write surface** may be EE/RBAC-restricted on Cloud; verify during Phase 1; if restricted, provider tools degrade to read-only + instructive errors.
6. **Upstream contribution:** keep external first; offer authoring MCP tools to Dify core once stable (their built-in MCP is run-only today).

## Appendix A — API Contracts (verified in repo)

**OpenAPI `/openapi/v1` (preferred; device-token; generated types exist):**
- OAuth device: `POST /oauth/device/code`, `POST /oauth/device/token` (+lookup/approve/deny, SSO branch)
- Apps: `GET /apps`, `GET /apps/{id}` (no create/delete here)
- Run: `POST /apps/{id}:run`; stop: `POST /apps/{id}/tasks/{tid}:stop`; events: `GET /apps/{id}/tasks/{tid}/events` (SSE)
- DSL: `POST /workspaces/{wid}/apps/imports` → `POST /workspaces/{wid}/apps/imports/{iid}:confirm`; `GET /apps/{id}/dsl`; `POST /apps/{id}/dependencies:check`
- Workspaces/members: `/workspaces[...]`; files: `POST /apps/{id}/files`; HITL: `human-input-forms/{token}[:submit]`

**Console `/console/api` (authoring-only; hand-typed; version-adapted):**
- Apps: `POST /apps` (modes: `chat | agent-chat | advanced-chat | workflow | completion`), `GET/PUT/DELETE /apps/{id}`, `/copy`, `/name`, `/icon`, `/convert-to-workflow`
- Draft: `GET|POST /apps/{id}/workflows/draft` — body `{graph, features, environment_variables, conversation_variables, hash}` → `{result, hash, updated_at}`; stale hash → `DraftWorkflowNotSync`
- Node defaults: `GET /apps/{id}/workflows/default-workflow-block-configs[/{type}]`
- Test: `POST .../workflows/draft/run` (SSE); `POST .../draft/nodes/{nid}/run` (+iteration/loop variants); node last-run `GET .../draft/nodes/{nid}/last-run`
- Publish/versions: `POST /apps/{id}/workflows/publish`; `GET /apps/{id}/workflows`; `GET/POST/DELETE /apps/{id}/workflows/{wid}` (restore/delete)
- Features: `GET|POST /apps/{id}/workflows/draft/features`
- Triggers: `GET|POST /apps/{id}/triggers`; `POST /apps/{id}/trigger-enable`; `GET /apps/{id}/workflows/triggers/webhook`; draft trigger runs
- Runs/stats: `GET /apps/{id}/workflow-runs[/{rid}[/node-executions]]`; `/apps/{id}/workflow/statistics/*`
- Providers/plugins: `console/workspace/model_providers.py`, `models.py`, `plugin.py`, `tool_providers.py`, `load_balancing_config.py`

## Appendix B — Reuse Map

| Need | Borrow from |
|---|---|
| Device-flow OAuth implementation reference | `difyctl` (`cli/src/api/oauth-device.ts`) |
| Typed OpenAPI client | `@dify/contracts/api/openapi` generated types |
| 3-layer graph validation + checklist parity | `Akabane71/dify-workflow-cli` (port rules to TS; target graphon 0.6.0 schemas) |
| Version adaptation (Legacy vs Modern) | `linhai0872/dify-dsl-pipe` adapter pattern |
| Validation test corpus | `api/tests/fixtures/workflow/*.yml` (real Dify fixtures) |
| MCP server scaffolding | `@modelcontextprotocol/sdk` (stable tools/resources subset) |
| DSL fixtures / examples | `svcvit/Awesome-Dify-Workflow` |

## Appendix C — Agent Host Setup (one line each, same binary)

```bash
# Claude Code
claude mcp add dify -- difywf mcp serve

# Codex (~/.codex/config.toml)
[mcp_servers.dify]
command = "difywf"
args = ["mcp", "serve"]

# Gemini CLI (~/.gemini/settings.json)
{ "mcpServers": { "dify": { "command": "difywf", "args": ["mcp", "serve"] } } }

# Cursor (.cursor/mcp.json)
{ "mcpServers": { "dify": { "command": "difywf", "args": ["mcp", "serve"] } } }

# Any shell-capable agent (no MCP needed)
difywf agent guide        # self-onboarding playbook
difywf app list -o json
```
