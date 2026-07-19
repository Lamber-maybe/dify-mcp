// Output contract shared by CLI and MCP. Every tool returns Result<T>;
// error codes and exit codes are stable so agents can parse, never scrape.

export type ErrCode =
  | "USAGE_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "RBAC_DENIED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFIRM_REQUIRED"
  | "DSL_VERSION_MISMATCH"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR";

export type Err = { code: ErrCode; message: string; retryable: boolean; details?: unknown };
export type Result<T> = { ok: true; data: T } | { ok: false; error: Err };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = (
  code: ErrCode,
  message: string,
  opts?: { retryable?: boolean; details?: unknown },
): Result<never> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: opts?.retryable ?? false,
    ...(opts?.details !== undefined ? { details: opts.details } : {}),
  },
});

export const EXIT: Record<ErrCode, number> & { OK: number } = {
  OK: 0,
  USAGE_ERROR: 2,
  AUTH_REQUIRED: 3,
  AUTH_EXPIRED: 3,
  CONFIRM_REQUIRED: 4,
  VALIDATION_FAILED: 5,
  RBAC_DENIED: 6,
  NOT_FOUND: 7,
  DSL_VERSION_MISMATCH: 8,
  RATE_LIMITED: 9,
  SERVER_ERROR: 10,
  NETWORK_ERROR: 11,
};

// Minimal YAML serializer for -o yaml. Handles the JSON-shaped data this tool
// emits (objects, arrays, scalars). Not a general YAML library.
export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return yamlScalar(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (item !== null && typeof item === "object") {
          const inner = toYaml(item, indent + 1);
          const childPad = "  ".repeat(indent + 1);
          return `${pad}- ${inner.startsWith(childPad) ? inner.slice(childPad.length) : inner}`;
        }
        return `${pad}- ${toYaml(item, 0)}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === "object") return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        return `${pad}${k}: ${toYaml(v, 0)}`;
      })
      .join("\n");
  }
  return String(value);
}

function yamlScalar(s: string): string {
  if (s === "") return "''";
  if (/^(true|false|null|~|[-+]?\d+(\.\d+)?)$/i.test(s)) return JSON.stringify(s);
  if (/[:#\[\]{}&*!|>'"%@`\n]|^[\s-]|\s$/.test(s)) return JSON.stringify(s);
  return s;
}
