// F1 spike (PRD KR6): which credential authorizes which surface on a live Dify?
// Console auth on current Dify is cookie+CSRF (not Bearer). This spike tests the
// OpenAPI Bearer token AND the console session cookies, with auto-refresh on 401.
// Prints an HTTP-status matrix; no secrets.
//
// Usage:
//   node scripts/auth-spike.mjs --base-url https://your-dify
//                               [--cookie-file cookies.json]            # browser cookie-export JSON, or a Cookie header string
//                               [--console-cookie "k=v; k2=v2" | '[{...}]']
//                               [--openapi-token T]
//                               [--email you@x --password '...']        # logs in to capture cookies
//                               [--app-id <id>]                          # target app for the draft probe
// Cookies are auto-filtered to the Dify auth cookies (access_token/console_token,
// csrf_token, refresh_token); unrelated cookies (analytics/consent) are ignored.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const get = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (get("base-url") ?? process.env.DIFY_API_BASE ?? "").replace(/\/+$/, "");
const openapiToken = get("openapi-token") ?? process.env.DIFY_OPENAPI_TOKEN;
if (!base) {
  console.error("need --base-url (or DIFY_API_BASE)");
  process.exit(2);
}

const AUTH_RE = /(?:^|[-_])(access_token|console_token|csrf_token|refresh_token)$/i;

// Persist refreshed cookies back to ~/.difywf/hosts.json. Dify rotates the
// refresh_token on every refresh (the old one is invalidated server-side), so any
// refresh that isn't saved orphans the new token and locks the session out.
function persistCookies(jar) {
  try {
    const fp = path.join(os.homedir(), ".difywf", "hosts.json");
    let hosts = {};
    try { hosts = JSON.parse(fs.readFileSync(fp, "utf8")); } catch {}
    hosts.hosts = hosts.hosts || {};
    hosts.hosts[base] = { ...(hosts.hosts[base] || {}), console_cookies: jar };
    hosts.active_host = hosts.active_host || base;
    fs.writeFileSync(fp, JSON.stringify(hosts, null, 2) + "\n", { mode: 0o600 });
    fs.chmodSync(fp, 0o600);
    return true;
  } catch {
    return false;
  }
}
const isAuth = (name) => AUTH_RE.test(name);
// Parse a cookie-export JSON array OR a raw "k=v; k2=v2" Cookie header. Pairs in a
// Cookie header are ';' separated (values may contain commas - do NOT split on ',').
function parseCookieInput(text) {
  const t = text.trim();
  let all = {};
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) for (const it of arr) if (it && it.name && typeof it.value === "string") all[it.name] = it.value;
    } catch {}
  } else {
    for (const part of t.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) all[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  const auth = {};
  for (const [k, v] of Object.entries(all)) if (isAuth(k)) auth[k] = v;
  return auth;
}

// Resolve cookies: --cookie-file > --console-cookie > ~/.difywf/hosts.json
let cookies = {};
let source = "(none)";
const cookieFile = get("cookie-file");
const cookieFlag = get("console-cookie");
if (cookieFile) {
  cookies = parseCookieInput(fs.readFileSync(cookieFile, "utf8"));
  source = `--cookie-file ${cookieFile}`;
} else if (cookieFlag) {
  cookies = parseCookieInput(cookieFlag);
  source = "--console-cookie flag";
} else {
  try {
    const hosts = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".difywf", "hosts.json"), "utf8"));
    const entry = hosts.hosts?.[hosts.active_host ?? base] ?? hosts.hosts?.[base];
    const stored = entry?.console_cookies ?? {};
    cookies = {};
    for (const [k, v] of Object.entries(stored)) if (isAuth(k)) cookies[k] = v;
    source = `~/.difywf/hosts.json [${hosts.active_host ?? base}]`;
  } catch (e) {
    source = `(no hosts.json: ${e.message})`;
  }
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
const csrfKey = Object.keys(cookies).find((k) => /csrf/i.test(k));
const has = (re) => Object.keys(cookies).some((k) => re.test(k));

console.log(`base: ${base}`);
console.log(`console cookies source: ${source}`);
console.log(`console cookie names: ${Object.keys(cookies).length ? Object.keys(cookies).join(", ") : "(none)"}`);
console.log(`auth cookie types present: access=${has(/access|console/i)} csrf=${has(/csrf/i)} refresh=${has(/refresh/i)}`);
if (!openapiToken) console.log("openapi token: (none)");

const refreshCookies = async (jar) => {
  const refreshKey = Object.keys(jar).find((k) => /refresh/i.test(k));
  if (!refreshKey) return null;
  try {
    const res = await fetch(`${base}/console/api/refresh-token`, {
      method: "POST",
      headers: { Cookie: cookieHeader(jar), ...(csrfKey ? { "X-CSRF-Token": jar[csrfKey] } : {}) },
    });
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    const out = { ...jar };
    for (const sc of list) {
      const pair = sc.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
    if (res.ok) {
      persistCookies(out); // save the rotated refresh_token so the session stays alive
      return out;
    }
    return null;
  } catch {
    return null;
  }
};

const probe = async (label, reqPath, { token, cookieJar, allowRefresh = false } = {}) => {
  const hasCookies = cookieJar && Object.keys(cookieJar).length > 0;
  if (!token && !hasCookies) return { label, path: reqPath, status: "skipped (no credential)", ok: false };
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (hasCookies) {
    headers.Cookie = cookieHeader(cookieJar);
    const ck = Object.keys(cookieJar).find((k) => /csrf/i.test(k));
    if (ck) headers["X-CSRF-Token"] = cookieJar[ck];
  }
  let res;
  try {
    res = await fetch(`${base}${reqPath}`, { headers });
  } catch (e) {
    return { label, path: reqPath, status: `network error: ${e.message}`, ok: false };
  }
  let status = `HTTP ${res.status}`;
  if (res.status === 401 && allowRefresh && hasCookies) {
    const refreshed = await refreshCookies(cookieJar);
    if (refreshed) {
      cookies = refreshed;
      const rh = { Cookie: cookieHeader(refreshed) };
      const ck2 = Object.keys(refreshed).find((k) => /csrf/i.test(k));
      if (ck2) rh["X-CSRF-Token"] = refreshed[ck2];
      const res2 = await fetch(`${base}${reqPath}`, { headers: rh });
      status = `HTTP 401 -> refreshed -> HTTP ${res2.status}`;
      return { label, path: reqPath, status, ok: res2.ok };
    }
    status = `HTTP 401 (refresh failed or no refresh_token)`;
  }
  return { label, path: reqPath, status, ok: res.ok };
};

const login = async (email, password) => {
  try {
    const res = await fetch(`${base}/console/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember_me: true, language: "en-US" }),
    });
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    const jar = {};
    for (const sc of list) {
      const pair = sc.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
    return { status: res.status, jar };
  } catch (e) {
    return { status: 0, error: e.message };
  }
};

const rows = [];
rows.push(await probe("openapi bearer", "/openapi/v1/apps", { token: openapiToken }));
rows.push(await probe("openapi bearer", "/console/api/apps", { token: openapiToken }));
rows.push(await probe("console cookies", "/console/api/apps", { cookieJar: cookies, allowRefresh: true }));

const email = get("email");
const password = get("password");
if (email && password) {
  const outcome = await login(email, password);
  if (outcome.jar && Object.keys(outcome.jar).length) {
    cookies = outcome.jar;
    rows.push({ label: "login", path: "/console/api/login", status: `HTTP ${outcome.status} -> ${Object.keys(outcome.jar).join(",")}`, ok: outcome.status < 300 });
    rows.push(await probe("console cookies (post-login)", "/console/api/apps", { cookieJar: cookies, allowRefresh: true }));
  } else {
    rows.push({ label: "login", path: "/console/api/login", status: outcome.error ? `error: ${outcome.error}` : `HTTP ${outcome.status} (no cookies set)`, ok: false });
  }
}

let consoleWorks = rows.some((r) => r.label.includes("console") && r.ok && r.path === "/console/api/apps");
let draftAppId = get("app-id");
if (consoleWorks && !draftAppId && Object.keys(cookies).length) {
  const lh = { Cookie: cookieHeader(cookies) };
  if (csrfKey) lh["X-CSRF-Token"] = cookies[csrfKey];
  const res = await fetch(`${base}/console/api/apps?limit=50`, { headers: lh });
  if (res.ok) {
    const data = await res.json();
    const apps = data.data ?? data;
    const wf = (Array.isArray(apps) ? apps : (apps.data ?? [])).find((a) => a.mode === "workflow" || a.mode === "advanced-chat");
    draftAppId = wf?.id;
  }
}
if (consoleWorks && draftAppId && Object.keys(cookies).length) {
  const r = await probe("console cookies", `/console/api/apps/${draftAppId}/workflows/draft`, { cookieJar: cookies, allowRefresh: true });
  rows.push({ label: r.label, path: `draft (app ${draftAppId})`, status: r.status, ok: r.ok });
  consoleWorks = !!r.ok;
}

console.log("\nF1 auth spike matrix:");
for (const r of rows) console.log(`  ${r.label.padEnd(34)} ${r.path.padEnd(46)} ${r.status}`);
console.log(
  consoleWorks
    ? "\nGATE: PASS - a console cookie credential reaches /console/api/apps/{id}/workflows/draft."
    : "\nGATE: FAIL. Easiest fix: export all cookies from your browser (cookie-editor -> Export -> JSON), save as cookies.json, then:\n  difywf auth import-cookies --base-url " + base + " --file cookies.json\n  node scripts/auth-spike.mjs --base-url " + base + " --cookie-file cookies.json\nIf cookies are present but 401 after refresh, re-export from a currently-active browser tab (access tokens expire fast).",
);
process.exit(consoleWorks ? 0 : 1);
