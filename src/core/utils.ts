import type { OnUnhandledRequestStrategy } from "./types";

// -------------------------
// Utilities
// -------------------------

export const headersToObject = (h: Headers) => Object.fromEntries(h.entries());

export const tryJson = async <T = unknown>(
  req: Request
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
  pathname: string
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

export function normalizeBaseUrl(u: string) {
  const base = new URL(u);
  // Normalize trailing slash in path (except root).
  if (base.pathname.endsWith("/") && base.pathname !== "/") {
    base.pathname = base.pathname.slice(0, -1);
  }
  return base.toString();
}

export function resolveStrategy(
  opt: OnUnhandledRequestStrategy | undefined,
  args: { request: Request; url: URL }
): "warn" | "error" | "bypass" {
  if (typeof opt === "function") {
    const r = opt(args);
    if (r === "warn" || r === "error" || r === "bypass") return r;
    return "warn";
  }
  return opt ?? "warn";
}
