import { INTERCEPT_LOG_PREFIX } from "./constants";
import type { OnUnhandledRequestStrategy } from "./types";

// -------------------------
// Environment Detection
// -------------------------

/**
 * Detect if we're running in a test environment.
 */
function isTestEnvironment(): boolean {
  return !!(
    process?.env &&
    (process.env.VITEST ||
      process.env.JEST_WORKER_ID ||
      process.env.NODE_ENV === "test")
  );
}

/**
 * Get the default onUnhandledRequest strategy based on environment.
 * - In test environments: 'error' (strict)
 * - Otherwise: 'warn' (permissive)
 */
export function getDefaultOnUnhandledRequest(): "error" | "warn" {
  return isTestEnvironment() ? "error" : "warn";
}

// -------------------------
// URL Utilities
// -------------------------

/**
 * Check if a URL string is absolute (starts with http:// or https://).
 */
export function isAbsoluteUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

/**
 * Normalize a URL string to a stable key for matching.
 * - Lowercases protocol and host (RFC: case-insensitive)
 * - Preserves pathname, search, and hash as serialized by URL
 */
export function normalizeAbsoluteUrl(input: string): string {
  const u = new URL(input);
  const protocol = u.protocol.toLowerCase();
  const host = u.host.toLowerCase();
  return `${protocol}//${host}${u.pathname}${u.search}${u.hash}`;
}

/**
 * Build a URL for an incoming request:
 * - Use the request URL as-is if it's absolute
 * - Otherwise resolve it against the provided origin
 * - If neither applies, throw with clear DX message
 */
export function toRequestUrl(reqUrl: string, origin: string | null): URL {
  if (isAbsoluteUrl(reqUrl)) return new URL(reqUrl);

  if (origin) return new URL(reqUrl, origin);

  throw new Error(
    `${INTERCEPT_LOG_PREFIX} Received a relative request URL "${reqUrl}" but no intercept.origin(...) is set for this test. ` +
      `Call intercept.origin("https://api.example.com") in beforeAll/beforeEach or use an absolute URL.`,
  );
}

// -------------------------
// Request/Response Utilities
// -------------------------

export const headersToObject = (h: Headers) => Object.fromEntries(h.entries());

export const tryJson = async <T = unknown>(
  req: Request,
): Promise<T | undefined> => {
  try {
    return (await req.clone().json()) as T;
  } catch {
    return undefined;
  }
};

const splitPath = (p: string) =>
  p.replace(/\/+/g, "/").replace(/\/$/g, "").split("/").filter(Boolean);

export function compilePattern(pattern: string): {
  re: RegExp;
  keys: string[];
  isStar: boolean;
} {
  if (pattern === "/*")
    return { re: /^\/(.*)$/i, keys: ["_star"], isStar: true };

  const keys: string[] = [];
  const srcBody = splitPath(pattern)
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  const src = `^/${srcBody}$`; // leading slash is part of the regex
  return { re: new RegExp(src, "i"), keys, isStar: false };
}

export function matchPattern(
  pattern: { re: RegExp; keys: string[] },
  pathname: string,
): Record<string, string> | null {
  const m = pattern.re.exec(pathname);
  if (!m) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < pattern.keys.length; i++) {
    const key = pattern.keys[i];
    if (key === undefined) continue;

    const raw = m[i + 1] ?? "";
    try {
      params[key] = decodeURIComponent(raw);
    } catch {
      params[key] = raw;
    }
  }

  return params;
}

export function resolveStrategy(
  opt: OnUnhandledRequestStrategy | undefined,
  args: { request: Request; url: URL },
): "warn" | "error" | "bypass" {
  if (typeof opt === "function") {
    const r = opt(args);
    if (r === "warn" || r === "error" || r === "bypass") return r;
    return "warn";
  }
  return opt ?? "warn";
}

/**
 * Validates and normalizes an origin URL.
 * - Requires protocol + host, no path/query/hash
 * - Returns normalized origin in lowercase (e.g., "https://api.example.com")
 * - Throws if the input is invalid
 */
export function validateOrigin(input: string): string {
  const url = new URL(input);

  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `${INTERCEPT_LOG_PREFIX} Expected an origin without path/query/hash, e.g. "https://api.example.com". Got: "${input}"`,
    );
  }

  const normalized = `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`;

  // Disallow malformed origins
  if (normalized.endsWith("//")) {
    throw new Error(`${INTERCEPT_LOG_PREFIX} Invalid origin: "${input}"`);
  }

  return normalized;
}
