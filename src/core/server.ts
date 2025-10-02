import { createAxiosAdapter } from "../adapters/axios";
import { createFetchAdapter } from "../adapters/fetch";
import { isAxiosLikeInstance } from "../adapters/types";
import { INTERCEPT_LOG_PREFIX } from "./constants";
import { logUnhandled } from "./log";
import {
  addCustomAdapter,
  clearCustomAdapters,
  getConfig,
  getOrigin,
  getOriginalFetch,
  isFetchAdapterAttached,
  resetConfig,
  resetOrigin,
  setConfig,
  setFetchAdapterAttached,
  setOriginalFetch,
  isListening as storeIsListening,
  setListening as storeSetListening,
} from "./store";
import type {
  Adapter,
  HttpMethod,
  ListenOptions,
  Path,
  TryHandleResult,
} from "./types";
import { compilePattern, matchPattern, tryJson } from "./utils";

// Minimal MSW-like test server (no MSW). Node 20+ (native fetch).
// Features: listen/resetHandlers/close/use, URL param matching, unhandled logging,
// and an adapter system (fetch/axios/custom) so the same handlers work across clients.

// -------------------------
// Internal state (module-local; OK to be local since listening/origin are global)
// -------------------------

type InternalHandler = {
  method: HttpMethod;
  compiled: ReturnType<typeof compilePattern>;
  pathPattern: Path;
  fn: (ctx: {
    request: Request;
    url: URL;
    params: Record<string, string>;
    body: unknown | undefined;
  }) => Response | Promise<Response>;
};

const _handlers: InternalHandler[] = []; // route stack (last wins)
const _adapters: Adapter[] = [];

/**
 * Get a list of all registered handlers for error messages.
 */
function getRegisteredHandlersInfo(): Array<{
  method: HttpMethod;
  path: Path;
}> {
  return _handlers.map((h) => ({
    method: h.method,
    path: h.pathPattern,
  }));
}

// -------------------------
// Helpers (absolute URL support)
// -------------------------

/** Very lightweight absolute URL check for http/https. */
function isAbsoluteUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

/**
 * Normalize a URL string to a stable key for matching.
 * - Lowercases protocol and host (RFC: case-insensitive)
 * - Preserves pathname, search, and hash as serialized by URL
 */
function normalizeAbsoluteUrl(input: string): string {
  const u = new URL(input);
  const protocol = u.protocol.toLowerCase();
  const host = u.host.toLowerCase();
  return `${protocol}//${host}${u.pathname}${u.search}${u.hash}`;
}

// -------------------------
// Core matching & dispatch
// -------------------------

/**
 * Find the last-registered handler that matches method + URL.
 *
 * Priority:
 *  1) Absolute URL handlers (exact match on normalized full URL)
 *  2) Relative handlers resolved against current origin (via intercept.origin)
 */
function findHandler(
  method: HttpMethod,
  url: URL,
): { handler: InternalHandler; params: Record<string, string> } | null {
  // 1) Absolute URL pass
  for (let i = _handlers.length - 1; i >= 0; i--) {
    const h = _handlers[i];
    if (!h) continue;
    if (h.method !== method) continue;

    const pattern = String(h.pathPattern);
    if (!isAbsoluteUrl(pattern)) continue;

    if (
      normalizeAbsoluteUrl(pattern) === normalizeAbsoluteUrl(url.toString())
    ) {
      return { handler: h, params: {} };
    }
  }

  // 2) Relative pass, scoped by active origin
  const activeOrigin = getOrigin();
  if (!activeOrigin) return null;

  const originUrl = new URL(activeOrigin);
  if (url.origin !== originUrl.origin) return null;

  const remainder = url.pathname || "/";

  for (let i = _handlers.length - 1; i >= 0; i--) {
    const h = _handlers[i];
    if (!h) continue;
    if (h.method !== method) continue;

    const pattern = String(h.pathPattern);
    // skip absolute handlers here; they were handled already
    if (/^https?:\/\//i.test(pattern)) continue;

    const m = matchPattern(h.compiled, remainder);
    if (!m && h.pathPattern !== "/*") continue;

    return { handler: h, params: m ?? {} };
  }
  return null;
}

/**
 * Build a URL for an incoming request:
 * - Use the request URL as-is if it's absolute
 * - Otherwise resolve it against the current origin (set via intercept.origin)
 * - If neither applies, throw with clear DX to enforce intercept.listen + origin usage
 */
function toRequestUrl(reqUrl: string): URL {
  if (/^https?:\/\//i.test(reqUrl)) return new URL(reqUrl);

  const o = getOrigin();
  if (o) return new URL(reqUrl, o);

  throw new Error(
    `${INTERCEPT_LOG_PREFIX} Received a relative request URL "${reqUrl}" but no intercept.origin(...) is set for this test. ` +
      `Call intercept.origin("https://api.example.com") in beforeAll/beforeEach or use an absolute URL.`,
  );
}

/**
 * Attempt to handle a Request. If a handler matches, returns `{ matched: true, res }`.
 * If none matches, returns `{ matched: false }` and lets the adapter decide what to do.
 */
async function tryHandle(req: Request): Promise<TryHandleResult> {
  let url: URL;
  try {
    url = toRequestUrl(req.url);
  } catch {
    return { matched: false };
  }

  const match = findHandler(req.method as HttpMethod, url);
  if (!match) return { matched: false };

  const body = await tryJson(req);
  const res = await match.handler.fn({
    request: req,
    url,
    params: match.params,
    body,
  });
  return { matched: true, res };
}

// -------------------------
// Public server API (singleton façade)
// -------------------------

export const server = {
  /**
   * Has listen() been called in this process?
   * (Shared via global store — robust to duplicate module loads.)
   */
  isListening(): boolean {
    return storeIsListening();
  },

  /**
   * Start (or update) the server configuration and attach default adapters.
   *
   * Supports { onUnhandledRequest, adapter }.
   * If called multiple times, options are merged and adapters remain attached.
   */
  listen(options: ListenOptions) {
    if (options.onUnhandledRequest) {
      setConfig({
        onUnhandledRequest: options.onUnhandledRequest,
      });
    }

    // Snapshot the *real* original fetch BEFORE patching (if any)
    const preAttachFetch =
      typeof globalThis.fetch === "function" ? globalThis.fetch : null;

    // Attach fetch adapter (default)
    if (!isFetchAdapterAttached() && typeof globalThis.fetch === "function") {
      const fetchAdapter = createFetchAdapter();
      fetchAdapter.attach({
        tryHandle,
        getOptions: () => {
          const config = getConfig();
          return {
            onUnhandledRequest: config.onUnhandledRequest ?? undefined,
          };
        },
        getRegisteredHandlers: getRegisteredHandlersInfo,
        logUnhandled,
      });
      _adapters.push(fetchAdapter);
      setFetchAdapterAttached(true);
    }

    // Store original fetch once (for proper restoration on close)
    if (!getOriginalFetch()) {
      setOriginalFetch(preAttachFetch);
    }

    // Attach custom adapter if provided (e.g., axios instance)
    if (options.adapter) {
      if (isAxiosLikeInstance(options.adapter)) {
        const axiosAdapter = createAxiosAdapter(options.adapter);
        axiosAdapter.attach({
          tryHandle,
          getOptions: () => {
            const config = getConfig();
            return {
              onUnhandledRequest: config.onUnhandledRequest ?? undefined,
            };
          },
          getRegisteredHandlers: getRegisteredHandlersInfo,
          logUnhandled,
        });
        _adapters.push(axiosAdapter);
        addCustomAdapter(axiosAdapter);
      }
    }

    storeSetListening(true);
  },

  /**
   * Register a route handler. Last registered wins (stack behavior).
   *
   * Throws a DX-friendly error if called before .listen().
   */
  use(method: HttpMethod, path: Path, fn: InternalHandler["fn"]) {
    if (!storeIsListening()) {
      throw new Error(
        `${INTERCEPT_LOG_PREFIX} You tried to register a route before intercept.listen(). ` +
          `Call intercept.listen({ onUnhandledRequest: 'error' | 'warn' | 'bypass' }) first ` +
          `— typically in setupTests.ts or in this file's beforeAll.`,
      );
    }

    const patternStr = String(path);
    const compiled = /^https?:\/\//i.test(patternStr)
      ? compilePattern("/*") // absolute URL matching is handled in findHandler, not via pattern
      : compilePattern(patternStr);

    _handlers.push({
      method,
      pathPattern: path,
      compiled,
      fn,
    });
  },

  /**
   * Remove all registered handlers (but keep configuration, origin and adapters).
   * NOTE: This does not flip the "listening" flag.
   */
  resetHandlers() {
    _handlers.length = 0;
  },

  /**
   * Detach all adapters, restore globals (like fetch), and clear handlers + options.
   * Resets origin & configs, and flips the shared listening flag to false.
   */
  close() {
    // Detach adapters in reverse order
    for (let i = _adapters.length - 1; i >= 0; i--) {
      const adapter = _adapters[i];
      if (!adapter) continue;
      try {
        adapter.detach();
      } catch {
        // ignore errors from adapter cleanup
      }
    }
    _adapters.length = 0;
    setFetchAdapterAttached(false);
    clearCustomAdapters();

    // Restore original fetch if we had one
    const original = getOriginalFetch();
    if (original) {
      globalThis.fetch = original;
      setOriginalFetch(null);
    }

    _handlers.length = 0;
    resetOrigin();
    resetConfig();
    storeSetListening(false);
  },

  /**
   * Read-only snapshot of the current options.
   */
  getOptions(): Readonly<ListenOptions> {
    const config = getConfig();
    const result: ListenOptions = {};
    if (config.onUnhandledRequest !== null) {
      result.onUnhandledRequest = config.onUnhandledRequest;
    }
    return result;
  },
};
