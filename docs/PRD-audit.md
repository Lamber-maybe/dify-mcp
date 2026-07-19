# Audit: PRD-dify-agent-workflow-cli-mcp.md

Scope: factual grounding vs `langgenius/dify` source (cloned 2026-07-19), internal consistency, missing surface, security. Findings ordered by severity. Verified refs point into `work/dify/`.

## Findings

### F1 [BLOCKER] Console-API auth feasibility is assumed, not verified
The entire P0 loop (draft sync, publish, node-run) lives on `/console/api/*` behind `login_required` (api/libs/login.py). The PRD says "reuse difyctl device-flow," but difyctl only exercises `/openapi/v1/*` (`cli/src/api/*` imports `@dify/contracts/api/openapi/types.gen` exclusively). Device flow (RFC 8628) exists server-side (`api/controllers/openapi/oauth_device.py`: `/oauth/device/code|token|approve|deny`, SSO branch in oauth_device_sso.py) and authorizes the OpenAPI surface. **No evidence in-repo that the device token authorizes console endpoints.** Console login is email/password or OAuth (`api/controllers/console/auth/login.py`, `oauth.py`); there is also `console/auth/oauth_server.py` (authorization server) that may offer a client-credentials path. Until one headless credential is proven against `GET /console/api/apps/{id}/workflows/draft`, Phase 0 should not start. PRD Open Question 1 understates this — it is the project gate, not a config detail.

### F2 [HIGH] Substrate split is wrong: OpenAPI already covers half the matrix
The official external surface `/openapi/v1` (device-token auth, typed via `@dify/contracts/api/openapi`) already provides:
- `GET /apps`, `GET /apps/{id}` (apps.py:149,133 — list/describe, **no create/delete**)
- `POST /apps/{id}:run`, `POST /apps/{id}/tasks/{tid}:stop` (app_run.py:141,177)
- `GET /apps/{id}/tasks/{tid}/events` — SSE task-event stream (workflow_events.py:46)
- DSL: `POST /workspaces/{id}/apps/imports`, `POST .../imports/{id}:confirm`, `GET /apps/{id}/dsl`, `POST /apps/{id}/dependencies:check` (app_dsl.py)
- workspaces + members CRUD (workspaces.py), file upload (files.py), HITL forms (human_input_form.py)

PRD Appendix A routes all of this through Console. Correction: use OpenAPI wherever it exists (stable, documented, device-token authorized) and reserve Console for what is console-only: **app create, draft sync, node defaults, publish, node-run, features, versions, triggers, statistics**. This also removes the need to hand-maintain types for half the client.

### F3 [HIGH] Model provider + plugin management missing from capability matrix
An agent-built workflow cannot pass `workflow.run_draft` without configured model credentials, and imported DSL fails without installed marketplace plugins. Both are Console surfaces the matrix omits: `console/workspace/model_providers.py`, `models.py`, `plugin.py`, `tool_providers.py`, `load_balancing_config.py`. Add `provider.*` and `plugin.*` tool groups at P0/P1 (KR2's "published, test-passing" is otherwise unreachable for LLM workflows).

### F4 [HIGH] Node schemas live in external `graphon==0.6.0` package, not the repo
`api/core/workflow/nodes/` contains only 9 newer node dirs (agent, agent_v2, datasource, human_input, knowledge_index, knowledge_retrieval, trigger_plugin/schedule/webhook). Classic nodes (llm, code, if-else, http-request, …) moved to the `graphon` pip package (`api/pyproject.toml:48`, imported throughout `workflow_service.py`). Consequences: (a) `default-workflow-block-configs` is the **only** in-API schema source — its completeness check must be a Phase-0 exit gate, not a "risk"; (b) any Akabane71-style reverse-engineering must target the graphon package source, not the dify repo; (c) add graphon version to the version-adapter matrix alongside DSL version.

### F5 [MEDIUM] DSL version unpinned; actual current is 0.7.0
`api/constants/dsl_version.py`: `CURRENT_APP_DSL_VERSION = "0.7.0"`. The PRD pins nothing; the chat that produced it cited 0.4.0 (a stale fixture), Akabane71 targets 0.6.0. Pin `target_dsl_version = 0.7.0` and add a drift check that fails loudly on mismatch.

### F6 [MEDIUM] Streaming assumption is weaker than reality
PRD assumes polling for run output. OpenAPI already exposes `GET /apps/{id}/tasks/{tid}/events` (SSE). Console draft-run also streams SSE. Decision needed per transport: bridge SSE→MCP progress notifications on Streamable HTTP; poll only for stdio clients. Cheap to specify now, annoying to retrofit.

### F7 [MEDIUM] Threat model gaps
- **Code-node sandbox**: agent-authored `code` nodes execute server-side. Add a policy (allow/deny code nodes, or require confirm) to the invariants.
- **`include_secret` export flag** (verified in `cli/src/commands/export/studio-app/run.ts`): default must be false; audit-log when true.
- **Console CSRF/cookie auth**: if console access ends up cookie-based, CSRF handling belongs in the client design; bearer is cleaner — fold into the F1 spike.
- **Tenant scoping**: workspace resolution must be asserted server-side per call; add a cross-tenant negative test.

### F8 [MEDIUM] No Test Plan
KRs exist but there is no acceptance strategy. Add: validator unit tests (graph fixtures from `api/tests/fixtures/workflow/*.yml`), contract tests against a live Dify docker instance (golden path: create→sync→run→publish), KR3 round-trip parity harness (export→import→diff), and a cross-version matrix (0.15.x vs 1.x, DSL 0.7.0).

### F9 [LOW] "Reuse difyctl auth" adopts an alpha dependency
difyctl is `0.2.0-alpha` (`cli/package.json`) and openapi-only. Sharing `hosts.yml` couples this project to an unstable format. Acceptable, but pin the integration and isolate it behind an auth adapter (which the PRD's layering already allows — say so explicitly).

### F10 [LOW] KR1 has no denominator
"≥90% of UI workflow-authoring actions" is unmeasurable without an inventory. Fix: the capability matrix is the inventory; KR1 = "% of P0+P1 matrix rows implemented and passing contract tests."

## What the PRD got right (verified against source)
- Console prefix `/console/api` (console/__init__.py:8) and all Appendix A console routes exist as cited.
- `CreateAppPayload` modes: `chat | agent-chat | advanced-chat | workflow | completion` (app.py) — the "5 modes" claim is exact.
- Draft-sync payload `{graph, features, environment_variables, conversation_variables, hash}` with optimistic-concurrency `WorkflowHashNotEqualError` (workflow.py DraftWorkflowApi).
- `default-workflow-block-configs` routes exist and return per-type defaults (workflow.py:1266,1291) — ADR-4's premise holds.
- Publish route, import 2-step + `check-dependencies`, export, triggers, statistics, node last-run — all present.
- "Existing MCP server is run-only" is correct (`core/mcp/server/streamable_http.py`: only `handle_list_tools`/`handle_call_tool`).
- Reuse map: `packages/contracts` generated openapi types exist and difyctl consumes them — the typed-client plan is sound.

## Verdict
Direction and layering are sound; the capability matrix is the right backbone. Ship-readiness blocked on exactly one unknown (F1 auth spike). F2/F3 are corrections that reduce work rather than add it. Recommend: (1) run the F1 spike before Phase 0, (2) re-cut Appendix A into OpenAPI vs Console columns, (3) add provider/plugin tool groups, (4) pin DSL 0.7.0 + graphon 0.6.0, (5) add the Test Plan section.
