# difywf

Agent-agnostic Dify workflow authoring. One TypeScript tool registry, two
surfaces - a CLI (`difywf`) any shell-capable agent can drive, and an MCP
server (stdio) any MCP host can attach. Lets an agent do everything a Dify UI
user can do: create apps, author workflow graphs, validate, test, publish,
plus import/export, triggers, providers/plugins, and observability.

Implements the MVP (Phase 0 + Phase 1 P0 loop) of
[docs/PRD-dify-agent-workflow-cli-mcp.md](docs/PRD-dify-agent-workflow-cli-mcp.md).
Audit findings are in [docs/PRD-audit.md](docs/PRD-audit.md).

## Why two surfaces

- **CLI is universal.** Claude Code, Codex, Gemini CLI, Cursor, Cline, Aider -
  every agent that can run a shell command gets full capability with no MCP.
- **MCP is convenience.** Same tools, same JSON contract, over stdio. Stable
  spec subset only: `tools` + `resources`. No elicitation/sampling/roots, so
  confirm gates are parameters (`confirm: true` / `--yes`), never prompts.
- Both return `{ "ok": bool, "data": ..., "error": { "code", "message", "retryable" } }`
  with stable exit codes. Agents parse JSON; they never scrape human text.

## Install

Requires Node >= 23.6 (native TypeScript type stripping - no build step).

```bash
git clone <this repo> difywf && cd difywf
npm install
npm link        # makes `difywf` available on PATH (optional)
```

## Configure

The Dify console uses **cookie + CSRF auth** (not a Bearer token). difywf stores the
console session cookies and replays them with an `X-CSRF-Token` header, auto-refreshing
via the `refresh_token` cookie on 401. Capturing them is now one command:

```bash
# EASIEST (Dify Cloud or self-hosted): export all cookies from your browser with a
# cookie-editor extension (Export -> JSON), save as cookies.json, then import. difywf
# auto-picks the 3 auth cookies (access_token, csrf_token, refresh_token) and ignores
# analytics/consent cookies - so you can't accidentally grab the wrong one.
difywf auth import-cookies --base-url https://your-dify --file cookies.json
# ...or pipe the JSON via stdin:
pbpaste | difywf auth import-cookies --base-url https://your-dify

# Self-hosted with email/password (no browser needed):
difywf auth login-console --base-url https://your-dify --email you@x --password '***'

# OpenAPI surface (run/export apps) is separate - device flow, Bearer token:
difywf auth login --base-url https://your-dify

difywf auth status        # shows base url, masked tokens, and console cookie names
```

A raw Cookie header also works: `difywf auth token --base-url ... --console-cookie "__Host-access_token=...; __Host-csrf_token=...; __Host-refresh_token=..."`.

Or via env (CI): `DIFY_API_BASE`, `DIFY_OPENAPI_TOKEN`, `DIFY_CONSOLE_TOKEN` (Bearer fallback), `DIFY_WORKSPACE_ID`.

> **F1 gate (PRD KR6):** run the spike to confirm which credential reaches the
> `/console/api` authoring surface on your edition:
> `node scripts/auth-spike.mjs --base-url https://your-dify [--cookie-file cookies.json] [--email you@x --password '***'] [--console-cookie "k=v; ..."] [--openapi-token T]`
> It prints an HTTP-status matrix (no secrets). The gate passes when a console
> cookie credential reaches `/console/api/apps/{id}/workflows/draft` with HTTP 200.

## Quickstart (agent golden path)

```bash
difywf agent guide                       # self-onboarding playbook
difywf app list -o json
difywf app create --mode workflow --name "demo"
difywf wf node defaults <app-id> llm     # fetch one node type's schema
difywf wf validate --graph graph.json    # offline: structure, refs, cycles, required fields
difywf wf draft sync <app-id> --graph graph.json --dry-run   # diff before save
difywf wf draft sync <app-id> --graph graph.json             # save
difywf wf test <app-id> --input query="hello"                # run draft
difywf wf publish <app-id> --yes                             # publish (confirm-gated)
```

Every command also works without tokens for offline ops (`agent guide`,
`wf validate`). API commands exit `3` (AUTH_REQUIRED) if unconfigured.

## MCP host setup (Appendix C)

Same binary, one line each:

```bash
# Claude Code
claude mcp add dify -- difywf mcp serve

# Codex (~/.codex/config.toml)
[mcp_servers.dify]
command = "difywf"
args = ["mcp", "serve"]

# Gemini CLI (~/.gemini/settings.json)
{ "mcpServers": { "dify": { "command": "difywf", "args": ["mcp", "serve"] } } }

# Cursor (.cursor/mcp.json) / Cline - same JSON shape
```

Without `difywf` on PATH, use the absolute path or `node /path/to/difywf/bin/difywf.js`.
Tool names: dots become underscores in MCP (`workflow.sync_draft` -> `workflow_sync_draft`).

## Tools (138 - full P0/P1/P2/P3 surface)

Run `difywf --help` for the live list, or `difywf agent guide` for the playbook.

- **P0 core loop (22):** `agent.guide`, `auth.status`,
  `app.{list,get,create,update,delete,export}`,
  `workflow.{get_draft,node_defaults,validate,sync_draft,run_draft,run,events,run_node,stop,publish}`,
  `provider.{list,models,set_credentials}`, `plugin.list`.
- **P1 lifecycle + integration:** `workflow.{get_features,set_features,list_env_vars,list_conv_vars,create_variable,update_variable,delete_variable,list_versions,get_version,restore,delete_version}`,
  `app.{copy,rename,set_icon,convert,import,check_deps}`,
  `trigger.{list,create,enable,webhook}`, `workflow.{trigger_run,trigger_run_all,hitl_preview,hitl_submit}`,
  `workspace.{list,get,switch,members}`, `file.upload`.
- **P2 observability + extras:** `runs.{list,get,node_executions,export}`,
  `stats.{daily_conversations,daily_terminals,token_costs,average_app_interactions,online_users}`,
  `comment.{list,add,resolve}`, `annotation.{list,add,delete}`,
  `audio.{transcribe,synthesize,voices}`, `rag.{list_datasets,list_templates}`,
  `explore.{run,stop}`, `archive.{list,download}`.
- **P3 deferred surfaces (62):** annotation completion
  (`annotation.{reply_action,reply_status,get_settings,update_settings,export,batch_import,import_status,hit_histories}`),
  RAG pipeline full lifecycle
  (`rag.{create_dataset,create_empty_dataset,get_template,get_draft,sync_draft,node_defaults,run_draft,run_published,run_node,stop,publish,list_versions,get_version,update_version,restore,delete_version}`),
  customized snippets
  (`snippet.{list,create,get,update,delete,export,import,import_confirm,check_deps,get_draft,sync_draft,node_defaults,publish,list_versions,restore,update_version,run_draft,run_node,stop,list_runs,get_run,run_node_executions}`),
  agent config/drive/sandbox
  (`agent.{config_manifest,config_skills,config_skill_upload,config_skill_inspect,config_skill_preview,config_files,config_file_upload,drive_files,drive_skills,drive_skill_inspect,drive_preview,drive_download,sandbox_info,sandbox_files,sandbox_read,sandbox_upload}`).

These four groups were the previously-deferred surfaces; they now mirror the
app-workflow tools (same contract, same confirm gates, same audit log). Multipart
uploads (annotation `batch_import`, agent skill/file/sandbox uploads) take a
file-payload object whose exact multipart shape is finalized in live verification.

## Safety

- Destructive ops (`publish`, `app.delete`, `provider.set_credentials`,
  `rag.{publish,restore,delete_version}`, `snippet.{delete,publish,restore}`,
  `annotation.{reply_action,update_settings,batch_import}`, agent uploads)
  require `confirm=true` / `--yes`. Without it: exit `4` (CONFIRM_REQUIRED).
- `sync_draft` validates the graph offline first; error-level issues abort
  with exit `5` (VALIDATION_FAILED) and the issue list.
- `--dry-run` on `sync_draft` returns a structural diff without saving.
- Every action appends to `~/.difywf/audit.jsonl` (secrets redacted).
- `provider.set_credentials` and any `--token` value are redacted in the audit log.

## Error codes & exit codes

`USAGE_ERROR(2)`, `AUTH_REQUIRED/AUTH_EXPIRED(3)`, `CONFIRM_REQUIRED(4)`,
`VALIDATION_FAILED(5)`, `RBAC_DENIED(6)`, `NOT_FOUND(7)`,
`DSL_VERSION_MISMATCH(8)`, `RATE_LIMITED(9)`, `SERVER_ERROR(10)`,
`NETWORK_ERROR(11)`. Check `error.retryable` before retrying.

## Develop

```bash
npm run typecheck   # tsc --noEmit (erasableSyntaxOnly; runs on Node 23.6+ native TS)
npm test            # node --test test/*.test.ts  (validators, contract, cli parsing)
npm run smoke:mcp   # scripts/mcp-smoke.mjs  (JSON-RPC handshake over stdio)
```

No build step. Source is run directly via Node's type stripping.

## Status

Full P0/P1/P2/P3 surface green: typecheck clean, 42 unit tests passing
(validators, contract, CLI parsing, import 2-step logic, sync dry-run diff,
registry invariants, MCP name parity, deferred-group wiring, cookie/CSRF auth
adapter + 401 auto-refresh + cookie-JSON import), MCP smoke passing (138 tools
over stdio), CLI exit-gate smokes passing. Auth adapter implements the cookie+CSRF
console model confirmed from Dify source; not yet live-verified against an
instance - the F1 spike (above) is the next step before any real authoring use.
