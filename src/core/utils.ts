import { INTERCEPT_LOG_PREFIX } from "./constants";
import type { OnUnhandledRequestStrategy } from "./types";

// -------------------------
// Utilities
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

/**
 * Ensures baseUrl has no trailing slash.
 * Throws a clear DX error if invalid.
 */
export function validateBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error(
      `${INTERCEPT_LOG_PREFIX} "baseUrl" must be a non-empty string, but got: ${String(
        baseUrl,
      )}`,
    );
  }

  if (baseUrl.endsWith("/")) {
    throw new Error(
      `${INTERCEPT_LOG_PREFIX} Invalid "baseUrl": "${baseUrl}"\n\n` +
        `→ Remove the trailing slash. Example:\n` +
        `  ❌ server.listen({ baseUrl: "${baseUrl}" })\n` +
        `  ✅ server.listen({ baseUrl: "${baseUrl.replace(/\/+$/, "")}" })\n`,
    );
  }

  return baseUrl;
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
