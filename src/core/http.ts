// Thin fetch wrapper mapping HTTP failures to the stable error contract.

import { err, ok, type ErrCode, type Result } from "./contract.ts";

export type RequestOpts = {
  method?: string;
  token?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  raw?: boolean; // return response text instead of parsed JSON
  cookies?: Record<string, string>; // console session cookies (cookie-auth surface)
  csrfToken?: string; // X-CSRF-Token header value (double-submit CSRF)
};

const STATUS_MAP: Record<number, ErrCode> = {
  400: "USAGE_ERROR",
  401: "AUTH_EXPIRED",
  403: "RBAC_DENIED",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
};

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function apiCall<T = unknown>(
  base: string,
  path: string,
  opts: RequestOpts = {},
): Promise<Result<T>> {
  const url = new URL(joinUrl(base, path));
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  applyCookies(headers, opts);
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    return err("NETWORK_ERROR", `request failed: ${e instanceof Error ? e.message : String(e)}`, {
      retryable: true,
    });
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const code = res.status >= 500 ? "SERVER_ERROR" : (STATUS_MAP[res.status] ?? "SERVER_ERROR");
    return err(code, extractMessage(data) ?? `HTTP ${res.status}`, {
      retryable: res.status >= 500 || res.status === 429,
      details: data ?? text.slice(0, 500),
    });
  }
  return ok((opts.raw ? text : data) as T);
}

// Collects an SSE stream into an array of parsed events.
// ponytail: no live streaming to the caller yet; add incremental output when
// a host actually needs it (both surfaces currently want the full result).
export async function readSse(
  base: string,
  path: string,
  opts: RequestOpts = {},
): Promise<Result<unknown[]>> {
  const url = new URL(joinUrl(base, path));
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  applyCookies(headers, opts);
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.body !== undefined ? "POST" : (opts.method ?? "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    return err("NETWORK_ERROR", `stream failed: ${e instanceof Error ? e.message : String(e)}`, {
      retryable: true,
    });
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const data = text ? safeJson(text) : null;
    const code = res.status >= 500 ? "SERVER_ERROR" : (STATUS_MAP[res.status] ?? "SERVER_ERROR");
    return err(code, extractMessage(data) ?? `HTTP ${res.status}`, {
      retryable: res.status >= 500,
      details: data,
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: unknown[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      events.push(safeJson(payload) ?? payload);
    }
  }
  return ok(events);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractMessage(data: unknown): string | null {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["message", "error", "detail", "code"]) {
      if (typeof d[k] === "string" && d[k]) return d[k] as string;
    }
  }
  return null;
}


// --- cookie + CSRF helpers (console surface uses cookie-auth, not Bearer) ---
export function applyCookies(headers: Record<string, string>, opts: RequestOpts): void {
  if (opts.cookies) {
    const c = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    if (c) headers.Cookie = c;
  }
  if (opts.csrfToken) headers["X-CSRF-Token"] = opts.csrfToken;
}

export function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

// Parse Set-Cookie response headers into a {name: value} map (attributes dropped).
export function parseSetCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const getter = (res.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const list = typeof getter === "function" ? getter.call(res.headers) : [];
  for (const sc of list) {
    const pair = sc.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

// Like apiCall but also returns Set-Cookie values (for login / refresh-token).
export async function fetchCapturingCookies(
  base: string,
  path: string,
  opts: RequestOpts = {},
): Promise<Result<{ data: unknown; cookies: Record<string, string> }>> {
  const url = new URL(joinUrl(base, path));
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  applyCookies(headers, opts);
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    return err("NETWORK_ERROR", `request failed: ${e instanceof Error ? e.message : String(e)}`, {
      retryable: true,
    });
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  const cookies = parseSetCookies(res);
  if (!res.ok) {
    const code = res.status >= 500 ? "SERVER_ERROR" : (STATUS_MAP[res.status] ?? "SERVER_ERROR");
    return err(code, extractMessage(data) ?? `HTTP ${res.status}`, {
      retryable: res.status >= 500 || res.status === 429,
      details: data ?? text.slice(0, 500),
    });
  }
  return ok({ data, cookies });
}
