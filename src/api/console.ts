// Client for the internal Console API /console/api. Authoring-only surface:
// app create/update/delete, draft sync, node defaults, publish, node runs,
// providers/plugins. Hand-typed; version adaptation lives here.

import { apiCall, readSse, type RequestOpts } from "../core/http.ts";
import { ok, err, type Result } from "../core/contract.ts";

export class ConsoleClient {
  base: string;
  token?: string;
  cookies?: Record<string, string>;
  onRefresh?: (cookies: Record<string, string>) => Promise<Record<string, string> | null>;
  constructor(
    base: string,
    token?: string,
    cookies?: Record<string, string>,
    onRefresh?: (cookies: Record<string, string>) => Promise<Record<string, string> | null>,
  ) {
    this.base = base;
    this.token = token;
    this.cookies = cookies;
    this.onRefresh = onRefresh;
  }

  // Cookie-auth (current Dify console) takes precedence; Bearer is the fallback
  // for the console OAuth-server surface or older token-based setups.
  private authOpts(opts: RequestOpts): RequestOpts {
    if (this.cookies && Object.keys(this.cookies).length) {
      const csrfKey = Object.keys(this.cookies).find((k) => /csrf/i.test(k));
      return { ...opts, cookies: this.cookies, csrfToken: csrfKey ? this.cookies[csrfKey] : undefined };
    }
    if (this.token) return { ...opts, token: this.token };
    return opts;
  }

  private async call<T = unknown>(path: string, opts: RequestOpts = {}): Promise<Result<T>> {
    let res = await apiCall<T>(`${this.base}/console/api`, path, this.authOpts(opts));
    // Auto-refresh the console session once on expiry using the refresh_token cookie.
    if (!res.ok && res.error.code === "AUTH_EXPIRED" && this.cookies && this.onRefresh) {
      const refreshed = await this.onRefresh(this.cookies);
      if (refreshed) {
        this.cookies = refreshed;
        res = await apiCall<T>(`${this.base}/console/api`, path, this.authOpts(opts));
      }
    }
    return res;
  }

  // --- apps ---
  listApps(q?: { page?: number; limit?: number; mode?: string; name?: string }): Promise<Result<unknown>> {
    return this.call("apps", { query: { page: q?.page, limit: q?.limit, mode: q?.mode, name: q?.name } });
  }
  getApp(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}`);
  }
  async exportDsl(appId: string): Promise<Result<string>> {
    const r = await this.call<{ data: string }>(`apps/${appId}/export`);
    return r.ok ? ok(r.data.data) : r;
  }
  createApp(body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call("apps", { body });
  }
  updateApp(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}`, { method: "PUT", body });
  }
  deleteApp(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}`, { method: "DELETE" });
  }

  // --- workspaces ---
  listWorkspaces(): Promise<Result<unknown>> {
    return this.call("workspaces");
  }

  // --- workflow authoring ---
  getDraft(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft`);
  }
  syncDraft(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft`, { body });
  }
  nodeDefaults(appId: string, nodeType?: string): Promise<Result<unknown>> {
    return this.call(
      `apps/${appId}/workflows/default-workflow-block-configs${nodeType ? `/${nodeType}` : ""}`,
    );
  }
  publish(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/publish`, { body });
  }

  // --- testing ---
  runDraft(appId: string, inputs: Record<string, unknown>): Promise<Result<unknown[]>> {
    return readSse(`${this.base}/console/api`, `apps/${appId}/workflows/draft/run`, this.authOpts({ body: { inputs } }));
  }
  runNode(
    appId: string,
    nodeId: string,
    inputs: Record<string, unknown>,
    mode: "node" | "iteration" | "loop" = "node",
  ): Promise<Result<unknown>> {
    const path =
      mode === "node"
        ? `apps/${appId}/workflows/draft/nodes/${nodeId}/run`
        : `apps/${appId}/workflows/draft/${mode}/nodes/${nodeId}/run`;
    return this.call(path, { body: { inputs } });
  }

  // --- providers / plugins ---
  listProviders(): Promise<Result<unknown>> {
    return this.call("workspaces/current/model-providers");
  }
  providerModels(provider: string): Promise<Result<unknown>> {
    return this.call(`workspaces/current/model-providers/${provider}/models`);
  }
  setProviderCredentials(provider: string, credentials: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`workspaces/current/model-providers/${provider}/credentials`, {
      body: { credentials },
    });
  }
  listPlugins(): Promise<Result<unknown>> {
    return this.call("workspaces/current/plugin/list");
  }

  // --- features & variables ---
  async getFeatures(appId: string): Promise<Result<unknown>> {
    // The features endpoint is POST-only (update); reads come from the draft.
    const r = await this.call<{ features: unknown }>(`apps/${appId}/workflows/draft`);
    return r.ok ? ok(r.data.features) : r;
  }
  setFeatures(appId: string, features: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/features`, { body: { features } });
  }
  listEnvVars(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/environment-variables`);
  }
  listConvVars(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/conversation-variables`);
  }
  async createVariable(appId: string, body: Record<string, unknown>, variableType?: string): Promise<Result<unknown>> {
    // Dify replaces env/conversation variables as a full list (no single-create).
    const isConv = variableType === "conversation";
    const endpoint = isConv ? "conversation-variables" : "environment-variables";
    const listKey = isConv ? "conversation_variables" : "environment_variables";
    const current = await this.call<{ items: Record<string, unknown>[] }>(`apps/${appId}/workflows/draft/${endpoint}`);
    if (!current.ok) return current;
    const items = current.data.items ?? [];
    return this.call(`apps/${appId}/workflows/draft/${endpoint}`, { body: { [listKey]: [...items, body] } });
  }
  updateVariable(appId: string, variableId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/variables/${variableId}`, { method: "PUT", body });
  }
  deleteVariable(appId: string, variableId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/variables/${variableId}`, { method: "DELETE" });
  }

  // --- versions ---
  listVersions(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows`);
  }
  async getVersion(appId: string, workflowId: string): Promise<Result<unknown>> {
    // The /workflows/{id} endpoint is PATCH/DELETE only; read via the list and filter.
    const r = await this.listVersions(appId);
    if (!r.ok) return r;
    const items = ((r.data as Record<string, unknown>).items ?? (r.data as Record<string, unknown>).data ?? []) as Record<string, unknown>[];
    const found = items.find((v) => v.id === workflowId);
    if (!found) return err("NOT_FOUND", `workflow version ${workflowId} not found`);
    return ok(found);
  }
  restoreVersion(appId: string, workflowId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/${workflowId}/restore`, { method: "POST" });
  }
  deleteVersion(appId: string, workflowId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/${workflowId}`, { method: "DELETE" });
  }

  // --- app metadata ---
  copyApp(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/copy`, { method: "POST" });
  }
  renameApp(appId: string, name: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/name`, { body: { name } });
  }
  setAppIcon(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/icon`, { body });
  }
  convertApp(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/convert-to-workflow`, { body });
  }

  // --- triggers ---
  listTriggers(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/triggers`);
  }
  createTrigger(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/triggers`, { body });
  }
  enableTrigger(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/trigger-enable`, { body });
  }
  webhookTrigger(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/triggers/webhook`);
  }
  triggerRun(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/trigger/run`, { body });
  }
  triggerRunAll(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/trigger/run-all`, { body });
  }

  // --- HITL ---
  hitlPreview(appId: string, nodeId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/human-input/nodes/${nodeId}/form/preview`, { body });
  }
  hitlSubmit(appId: string, nodeId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflows/draft/human-input/nodes/${nodeId}/form/run`, { body });
  }

  // --- runs & stats ---
  listRuns(appId: string, q?: { page?: number; limit?: number; status?: string }): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflow-runs`, { query: { page: q?.page, limit: q?.limit, status: q?.status } });
  }
  getRun(appId: string, runId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflow-runs/${runId}`);
  }
  runNodeExecutions(appId: string, runId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflow-runs/${runId}/node-executions`);
  }
  exportRun(appId: string, runId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflow-runs/${runId}/export`);
  }
  stats(appId: string, metric: string, q?: { start?: string; end?: string }): Promise<Result<unknown>> {
    // Dify expects "%Y-%m-%d %H:%M"; accept ISO dates and date-only strings too.
    const norm = (d?: string): string | undefined => {
      if (!d) return undefined;
      if (d.includes(" ")) return d;
      if (d.includes("T")) return d.replace("T", " ").slice(0, 16);
      return `${d} 00:00`;
    };
    return this.call(`apps/${appId}/workflow/statistics/${metric}`, { query: { start: norm(q?.start), end: norm(q?.end) } });
  }
  onlineUsers(q?: { page?: number; limit?: number }): Promise<Result<unknown>> {
    return this.call(`apps/workflows/online-users`, { query: { page: q?.page, limit: q?.limit } });
  }

  // --- comments ---
  listComments(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflow/comments`);
  }
  addComment(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflow/comments`, { body });
  }
  resolveComment(appId: string, commentId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/workflow/comments/${commentId}/resolve`, { method: "POST" });
  }

  // --- annotations ---
  listAnnotations(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotations`);
  }
  addAnnotation(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotations`, { body });
  }
  deleteAnnotation(appId: string, annotationId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotations/${annotationId}`, { method: "DELETE" });
  }

  // --- audio ---
  audioToText(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/audio-to-text`, { body });
  }
  textToAudio(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/text-to-audio`, { body });
  }
  listVoices(appId: string, language: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/text-to-audio/voices`, { query: { language } });
  }

  // --- rag pipelines (read-only list) ---
  listRagDatasets(q?: { page?: number; limit?: number; keyword?: string }): Promise<Result<unknown>> {
    // /rag/pipeline/dataset is POST-only (import); datasets are listed via /datasets.
    return this.call("datasets", { query: { page: q?.page, limit: q?.limit, keyword: q?.keyword } });
  }
  listRagTemplates(): Promise<Result<unknown>> {
    return this.call(`rag/pipeline/templates`);
  }

  // --- explore (installed apps) ---
  runInstalledApp(installedAppId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`installed-apps/${installedAppId}/workflows/run`, { body });
  }
  stopInstalledApp(installedAppId: string, taskId: string): Promise<Result<unknown>> {
    return this.call(`installed-apps/${installedAppId}/workflows/tasks/${taskId}/stop`, { method: "POST" });
  }

  // --- run archives ---
  listRunArchives(q?: { page?: number; limit?: number }): Promise<Result<unknown>> {
    return this.call(`workflow-run-archives`, { query: { page: q?.page, limit: q?.limit } });
  }
  downloadRunArchive(body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`workflow-run-archives/downloads`, { body });
  }

  // --- annotations (completion: reply action, settings, export, batch import) ---
  annotationReplyAction(appId: string, action: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotation-reply/${action}`, { method: "POST" });
  }
  annotationReplyStatus(appId: string, action: string, jobId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotation-reply/${action}/status/${jobId}`);
  }
  getAnnotationSetting(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotation-setting`);
  }
  updateAnnotationSetting(appId: string, settingId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotation-settings/${settingId}`, { body });
  }
  exportAnnotations(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotations/export`);
  }
  batchImportAnnotations(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotations/batch-import`, { body });
  }
  annotationImportStatus(appId: string, jobId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotations/batch-import-status/${jobId}`);
  }
  annotationHitHistories(appId: string, annotationId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/annotations/${annotationId}/hit-histories`);
  }

  // --- rag pipeline (full CRUD + authoring, pipeline_id-scoped) ---
  createRagDataset(body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`rag/pipeline/dataset`, { body });
  }
  createEmptyRagDataset(body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`rag/pipeline/empty-dataset`, { body });
  }
  getRagTemplate(templateId: string): Promise<Result<unknown>> {
    return this.call(`rag/pipeline/templates/${templateId}`);
  }
  getRagDraft(pipelineId: string): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/draft`);
  }
  syncRagDraft(pipelineId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/draft`, { body });
  }
  ragNodeDefaults(pipelineId: string, blockType?: string): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/default-workflow-block-configs${blockType ? `/${blockType}` : ""}`);
  }
  runRagDraft(pipelineId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/draft/run`, { body });
  }
  runRagPublished(pipelineId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/published/run`, { body });
  }
  runRagNode(pipelineId: string, nodeId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/draft/nodes/${nodeId}/run`, { body });
  }
  stopRagTask(pipelineId: string, taskId: string): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflow-runs/tasks/${taskId}/stop`, { method: "POST" });
  }
  publishRag(pipelineId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/publish`, { body });
  }
  listRagVersions(pipelineId: string): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows`);
  }
  getRagVersion(pipelineId: string, workflowId: string): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/${workflowId}`);
  }
  updateRagVersion(pipelineId: string, workflowId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/${workflowId}`, { method: "PATCH", body });
  }
  restoreRagVersion(pipelineId: string, workflowId: string): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/${workflowId}/restore`, { method: "POST" });
  }
  deleteRagVersion(pipelineId: string, workflowId: string): Promise<Result<unknown>> {
    return this.call(`rag/pipelines/${pipelineId}/workflows/${workflowId}`, { method: "DELETE" });
  }

  // --- customized snippets (workspace lifecycle + workflow authoring) ---
  listSnippets(q?: { page?: number; limit?: number; keyword?: string }): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets`, { query: { page: q?.page, limit: q?.limit, keyword: q?.keyword } });
  }
  createSnippet(body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets`, { body });
  }
  getSnippet(snippetId: string): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets/${snippetId}`);
  }
  updateSnippet(snippetId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets/${snippetId}`, { method: "PATCH", body });
  }
  deleteSnippet(snippetId: string): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets/${snippetId}`, { method: "DELETE" });
  }
  exportSnippet(snippetId: string): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets/${snippetId}/export`);
  }
  importSnippet(body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets/imports`, { body });
  }
  confirmSnippetImport(importId: string): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets/imports/${importId}/confirm`, { method: "POST" });
  }
  checkSnippetDeps(snippetId: string): Promise<Result<unknown>> {
    return this.call(`workspaces/current/customized-snippets/${snippetId}/check-dependencies`);
  }
  getSnippetDraft(snippetId: string): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows/draft`);
  }
  syncSnippetDraft(snippetId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows/draft`, { body });
  }
  snippetNodeDefaults(snippetId: string): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows/default-workflow-block-configs`);
  }
  publishSnippet(snippetId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows/publish`, { body });
  }
  listSnippetVersions(snippetId: string): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows`);
  }
  restoreSnippetVersion(snippetId: string, workflowId: string): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows/${workflowId}/restore`, { method: "POST" });
  }
  updateSnippetVersion(snippetId: string, workflowId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows/${workflowId}`, { method: "PATCH", body });
  }
  runSnippetDraft(snippetId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows/draft/run`, { body });
  }
  runSnippetNode(snippetId: string, nodeId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflows/draft/nodes/${nodeId}/run`, { body });
  }
  stopSnippetTask(snippetId: string, taskId: string): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflow-runs/tasks/${taskId}/stop`, { method: "POST" });
  }
  listSnippetRuns(snippetId: string, q?: { page?: number; limit?: number }): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflow-runs`, { query: { page: q?.page, limit: q?.limit } });
  }
  getSnippetRun(snippetId: string, runId: string): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflow-runs/${runId}`);
  }
  snippetRunNodeExecutions(snippetId: string, runId: string): Promise<Result<unknown>> {
    return this.call(`snippets/${snippetId}/workflow-runs/${runId}/node-executions`);
  }

  // --- agent config / drive / sandbox ---
  agentConfigManifest(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/config/manifest`);
  }
  agentConfigSkills(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/config/skills`);
  }
  agentConfigSkillUpload(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/config/skills/upload`, { body });
  }
  agentConfigSkillInspect(appId: string, name: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/config/skills/${name}/inspect`);
  }
  agentConfigSkillPreview(appId: string, name: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/config/skills/${name}/files/preview`);
  }
  agentConfigFiles(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/config/files`);
  }
  agentConfigFileUpload(appId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/config/files`, { body });
  }
  agentDriveFiles(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/drive/files`);
  }
  agentDriveSkills(appId: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/drive/skills`);
  }
  agentDriveSkillInspect(appId: string, skillPath: string): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/drive/skills/${skillPath}/inspect`);
  }
  agentDrivePreview(appId: string, params: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/drive/files/preview`, { query: params as Record<string, string | number | boolean | undefined> });
  }
  agentDriveDownload(appId: string, params: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`apps/${appId}/agent/drive/files/download`, { query: params as Record<string, string | number | boolean | undefined> });
  }
  agentSandboxInfo(agentId: string): Promise<Result<unknown>> {
    return this.call(`agent/${agentId}/sandbox`);
  }
  agentSandboxFiles(agentId: string): Promise<Result<unknown>> {
    return this.call(`agent/${agentId}/sandbox/files`);
  }
  agentSandboxRead(agentId: string, params: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`agent/${agentId}/sandbox/files/read`, { query: params as Record<string, string | number | boolean | undefined> });
  }
  agentSandboxUpload(agentId: string, body: Record<string, unknown>): Promise<Result<unknown>> {
    return this.call(`agent/${agentId}/sandbox/files/upload`, { body });
  }
}
