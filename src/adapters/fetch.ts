import type { Adapter, CoreForAdapter } from "../core/types";
import { headersToObject, resolveStrategy } from "../core/utils";
import { HttpResponse } from "../http/response";

/**
 * Fetch adapter: monkey-patches global `fetch` while attached.
 * - "warn": log and delegate to the original fetch (or 500 synthetic if absent)
 * - "bypass": silently delegate to the original fetch (or 500 synthetic if absent)
 * - "error": return a 501 JSON response (no delegate).
 */
export function createFetchAdapter(): Adapter {
  let original: typeof globalThis.fetch | null = null;

  // Build a URL for logging even when req.url is relative
  const urlForLogs = (req: Request): URL => {
    try {
      // Absolute URLs parse fine without base
      return new URL(req.url);
    } catch {
      // Relative URL: use a stable, fake base only for logs/diagnostics
      return new URL(req.url, "http://origin.invalid");
    }
  };

  // Passthrough helper (falls back to synthetic 500 if no original)
  const passthrough = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): Promise<Response> => {
    const orig = original;
    if (!orig) {
      return HttpResponse.json(
        { error: "No original fetch available for passthrough" },
        { status: 500 },
      );
    }
    return orig(input, init);
  };

  return {
    attach(core: CoreForAdapter) {
      if (original) return; // already attached
      original = globalThis.fetch ?? null; // capture current fetch (may be undefined in some envs)

      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const req = new Request(input, init);

        // First, let the core try to handle this
        const result = await core.tryHandle(req);
        if (result.matched) {
          return result.res;
        }

        // Unhandled: decide what to do
        const url = urlForLogs(req);
        const strategy = resolveStrategy(
          core.getOptions().onUnhandledRequest ?? undefined,
          { request: req, url },
        );

        if (strategy === "warn") {
          core.logUnhandled("warn", req, url, core.getRegisteredHandlers());
          return passthrough(input, init);
        }

        if (strategy === "bypass") {
          return passthrough(input, init);
        }

        // "error" -> block with 501 JSON
        core.logUnhandled("error", req, url, core.getRegisteredHandlers());
        const details = {
          method: req.method,
          url: url.toString(),
          headers: headersToObject(req.headers),
        };
        return HttpResponse.json(
          { error: "Unhandled request", details },
          { status: 501 },
        );
      };
    },

    detach() {
      if (original) {
        globalThis.fetch = original;
        original = null;
      }
    },
  };
}
