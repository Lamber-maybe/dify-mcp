// Config resolution: flags > env > hosts file (~/.difywf/hosts.json, mode 0600).
// Same resolution path for CLI and MCP so behavior is identical on both surfaces.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type HostEntry = {
  openapi_token?: string;
  console_token?: string;
  console_cookies?: Record<string, string>;
  workspace_id?: string;
};
export type HostsFile = { active_host?: string; hosts: Record<string, HostEntry> };

export type Config = {
  baseUrl: string;
  openapiToken?: string;
  consoleToken?: string;
  consoleCookies?: Record<string, string>;
  workspaceId?: string;
};

export type Flags = Record<string, unknown>;

export const storePath = (): string => path.join(os.homedir(), ".difywf", "hosts.json");

export function loadHosts(): HostsFile {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8")) as HostsFile;
  } catch {
    return { hosts: {} };
  }
}

export function saveHosts(h: HostsFile): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(h, null, 2), { mode: 0o600 });
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

export function resolveConfig(flags: Flags): Config {
  const hosts = loadHosts();
  const baseUrl =
    str(flags["base-url"]) ?? process.env.DIFY_API_BASE ?? hosts.active_host ?? "";
  const entry = baseUrl ? hosts.hosts[baseUrl] ?? {} : {};
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    openapiToken:
      str(flags["openapi-token"]) ?? process.env.DIFY_OPENAPI_TOKEN ?? entry.openapi_token,
    consoleToken:
      str(flags["console-token"]) ?? process.env.DIFY_CONSOLE_TOKEN ?? entry.console_token,
    consoleCookies: entry.console_cookies,
    workspaceId:
      str(flags.workspace) ?? process.env.DIFY_WORKSPACE_ID ?? entry.workspace_id,
  };
}

export function maskToken(t?: string): string | null {
  if (!t) return null;
  if (t.length <= 8) return "***";
  return `${t.slice(0, 4)}...${t.slice(-4)}`;
}
