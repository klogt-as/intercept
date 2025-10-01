import { createFetchAdapter } from "../adapters/fetch";
import { INTERCEPT_LOG_PREFIX } from "./constants";
import { logUnhandled } from "./log";
import { getActiveOrigin, resetActiveOrigin } from "./origin";
import { getConfigs, resetConfigs, setConfigs } from "./store";
import type {
  Adapter,
  HttpMethod,
  ListenOptions, // NOTE: this must now only include { onUnhandledRequest?: ... }
  Path,
  TryHandleResult,
} from "./types";
import { compilePattern, matchPattern, tryJson } from "./utils";

// Minimal MSW-like test server (no MSW). Node 20+ (native fetch).
// Features: listen/resetHandlers/close/use, URL param matching, unhandled logging,
// and an adapter system (fetch/axios/custom) so the same handlers work across clients.

// -------------------------
// Internal state
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

let _originalFetch: typeof globalThis.fetch | null = null;
const _handlers: InternalHandler[] = [];
let _fetchAdapterAttached = false;

const _adapters: Adapter[] = [];

// Tracks whether .listen() has been called at least once in this process.
let _listening = false;

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
  const activeOrigin = getActiveOrigin();
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

  const o = getActiveOrigin();
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
// Public server API (singleton)
// -------------------------

export const server = {
  /**
   * Has listen() been called in this process?
   */
  isListening(): boolean {
    return _listening;
  },

  /**
   * Start (or update) the server configuration and attach default adapters.
   *
   * Only supports { onUnhandledRequest }.
   * If called multiple times, options are merged and adapters remain attached.
   */
  listen(options: ListenOptions) {
    setConfigs({
      onUnhandledRequest: options.onUnhandledRequest ?? null,
    });

    const preAttachFetch =
      typeof globalThis.fetch === "function" ? globalThis.fetch : null;

    if (!_fetchAdapterAttached && typeof globalThis.fetch === "function") {
      const fetchAdapter = createFetchAdapter();
      fetchAdapter.attach({
        tryHandle,
        getOptions: () => {
          const configs = getConfigs();
          return {
            onUnhandledRequest: configs.onUnhandledRequest ?? null,
          } as const;
        },
        logUnhandled,
      });
      _adapters.push(fetchAdapter);
      _fetchAdapterAttached = true;
    }

    if (!_originalFetch) {
      _originalFetch = preAttachFetch;
    }

    _listening = true;
  },

  /**
   * Register a route handler. Last registered wins (stack behavior).
   *
   * Throws a DX-friendly error if called before .listen().
   *
   * @param method HTTP method to match
   * @param path Path pattern. Supports `/users/:id`, `/*`, and absolute URLs `https://host/path`
   * @param fn Handler invoked when the request matches
   */
  use(method: HttpMethod, path: Path, fn: InternalHandler["fn"]) {
    if (!_listening) {
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
   * Remove all registered handlers (but keep configuration and adapters).
   */
  resetHandlers() {
    _handlers.length = 0;
  },

  /**
   * Detach all adapters, restore globals (like fetch), and clear handlers + options.
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
    _fetchAdapterAttached = false;

    // If fetch was patched, ensure it's restored (fetch adapter already tries to do this)
    if (_originalFetch) {
      globalThis.fetch = _originalFetch;
      _originalFetch = null;
    }

    _handlers.length = 0;
    resetActiveOrigin();
    resetConfigs();
    _listening = false;
  },

  /**
   * Attach a custom adapter (or one of the helpers like `createAxiosAdapter`).
   *
   * @example
   *   const instance = axios.create({ baseURL: 'http://localhost' });
   *   server.attachAdapter(createAxiosAdapter(instance));
   */
  attachAdapter(adapter: Adapter) {
    const configs = getConfigs();
    adapter.attach({
      tryHandle,
      getOptions: () => configs,
      logUnhandled,
    });
    _adapters.push(adapter);
  },

  /**
   * Detach (and remove) a previously attached adapter instance.
   */
  detachAdapter(adapter: Adapter) {
    const i = _adapters.indexOf(adapter);
    if (i >= 0) {
      try {
        adapter.detach();
      } finally {
        _adapters.splice(i, 1);
      }
    }
  },

  /**
   * Read-only snapshot of the current options.
   */
  getOptions(): Readonly<ListenOptions> {
    const configs = getConfigs();
    return configs;
  },
};
