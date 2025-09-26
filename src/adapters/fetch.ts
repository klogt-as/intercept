import type { Adapter, CoreForAdapter } from "../core/types";
import { headersToObject, resolveStrategy } from "../core/utils";
import { HttpResponse } from "../http/response";

/**
 * Fetch adapter: monkey-patches global `fetch` while attached.
 * - "warn": log and delegate to the original fetch.
 * - "bypass": silently delegate to the original fetch.
 * - "error": return a 501 JSON response (no delegate).
 */
export function createFetchAdapter(): Adapter {
  let original: typeof globalThis.fetch | null = null;

  return {
    attach(core: CoreForAdapter) {
      if (original) return; // already attached
      original = globalThis.fetch; // capture the previous fetch (non-null in Node 18+/20+)

      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const req = new Request(input, init);
        const url = new URL(req.url, core.getOptions().baseUrl);

        // helper to always passthrough to the captured original fetch
        const passthrough = (): Promise<Response> => {
          const orig = original;
          if (!orig) {
            throw new Error("Invariant: original fetch is not available");
          }
          return orig(input, init);
        };

        const result = await core.tryHandle(req);
        if (result.matched) {
          return result.res; // discriminated union guarantees res here
        }

        // Unhandled: apply strategy
        const strategy = resolveStrategy(core.getOptions().onUnhandledRequest, {
          request: req,
          url,
        });

        if (strategy === "warn") {
          core.logUnhandled("warn", req, url);
          return passthrough();
        }

        if (strategy === "bypass") {
          return passthrough();
        }

        // "error" -> block with 501
        core.logUnhandled("error", req, url);
        const details = {
          method: req.method,
          url: url.toString(),
          headers: headersToObject(req.headers),
        };
        return HttpResponse.json(
          { error: "Unhandled request", details },
          { status: 501 }
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
