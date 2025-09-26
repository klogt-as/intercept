import { createFetchAdapter } from "../adapters/fetch";
import { logUnhandled } from "./log";
import type {
  Adapter,
  HttpMethod,
  ListenOptions,
  Path,
  TryHandleResult,
} from "./types";
import {
  compilePattern,
  matchPattern,
  normalizeBaseUrl,
  tryJson,
} from "./utils";

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

let _currentOptions: ListenOptions = {
  onUnhandledRequest: "warn",
  baseUrl: "http://localhost",
};

const _adapters: Adapter[] = [];

// -------------------------
// Core matching & dispatch
// -------------------------

/**
 * Find the last-registered handler that matches method + URL.
 */
function findHandler(
  method: HttpMethod,
  url: URL
): { handler: InternalHandler; params: Record<string, string> } | null {
  const base = new URL(_currentOptions.baseUrl);

  if (url.origin !== base.origin) return null;
  if (!url.pathname.startsWith(base.pathname)) return null;

  const raw = url.pathname.slice(base.pathname.length) || "/";
  const remainder = raw.startsWith("/") ? raw : `/${raw}`;

  for (let i = _handlers.length - 1; i >= 0; i--) {
    const h = _handlers[i];
    if (h.method !== method) continue;

    const m = matchPattern(h.compiled, remainder);
    if (!m && h.pathPattern !== "/*") continue;

    return { handler: h, params: m ?? {} };
  }
  return null;
}

/**
 * Attempt to handle a Request. If a handler matches, returns `{ matched: true, res }`.
 * If none matches, returns `{ matched: false }` and lets the adapter decide what to do.
 */
async function tryHandle(req: Request): Promise<TryHandleResult> {
  const url = new URL(req.url, _currentOptions.baseUrl);
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
   * Start (or update) the server configuration and attach default adapters.
   *
   * If called multiple times, options are merged and adapters remain attached.
   * By default, we attach the Fetch adapter if available and not already attached.
   */
  listen(options: ListenOptions) {
    // Merge/normalize options
    const normalized: ListenOptions = {
      ..._currentOptions,
      ...options,
      baseUrl: normalizeBaseUrl(options.baseUrl ?? _currentOptions.baseUrl),
    };
    _currentOptions = normalized;

    // Ensure fetch adapter is attached once (for most libs, including many GraphQL clients)
    if (
      !_originalFetch &&
      !_fetchAdapterAttached &&
      typeof globalThis.fetch === "function"
    ) {
      const fetchAdapter = createFetchAdapter();
      fetchAdapter.attach({
        tryHandle,
        getOptions: () => _currentOptions as Required<ListenOptions>,
        logUnhandled,
      });
      _adapters.push(fetchAdapter);
      _originalFetch = globalThis.fetch; // Remember we patched fetch via adapter
      _fetchAdapterAttached = true;
    }
  },

  /**
   * Register a route handler. Last registered wins (stack behavior).
   *
   * @param method HTTP method to match
   * @param path Path pattern. Supports `/users/:id` and `/*`
   * @param fn Handler invoked when the request matches
   */
  use(method: HttpMethod, path: Path, fn: InternalHandler["fn"]) {
    _handlers.push({
      method,
      pathPattern: path,
      compiled: compilePattern(path),
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
      try {
        _adapters[i].detach();
      } catch {
        // ignore
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
    _currentOptions = {
      onUnhandledRequest: "warn",
      baseUrl: "http://localhost",
    };
  },

  /**
   * Attach a custom adapter (or one of the helpers like `createAxiosAdapter`).
   *
   * @example
   *   const ax = axios.create({ baseURL: 'http://localhost' });
   *   server.attachAdapter(createAxiosAdapter(ax));
   */
  attachAdapter(adapter: Adapter) {
    adapter.attach({
      tryHandle,
      getOptions: () => _currentOptions as Required<ListenOptions>,
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
   * Read-only snapshot of the current baseUrl (useful for adapters).
   */
  getBaseUrl(): string {
    return _currentOptions.baseUrl;
  },

  /**
   * Read-only snapshot of the current options.
   */
  getOptions(): Readonly<ListenOptions> {
    return _currentOptions;
  },
};
