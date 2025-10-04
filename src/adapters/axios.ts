import { getOrigin } from "../core/store";
import type { Adapter, CoreForAdapter } from "../core/types";
import { headersToObject, resolveStrategy } from "../core/utils";
import { HttpResponse } from "../http/response";
import type {
  AxiosAdapterFn,
  AxiosLikeInstance,
  CompatibleAxiosInstance,
  MinimalAxiosConfig,
  MinimalAxiosError,
  MinimalAxiosResponse,
} from "./types";

const REL_BASE = "http://origin.invalid";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Guard to determine if a value can be used as a Fetch BodyInit directly.
 */
function isBodyInit(value: unknown): value is BodyInit {
  if (value == null) return false;
  if (typeof value === "string") return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (typeof FormData !== "undefined" && value instanceof FormData) return true;
  if (
    typeof URLSearchParams !== "undefined" &&
    value instanceof URLSearchParams
  )
    return true;
  if (value instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(value)) return true;
  // Node streams / WHATWG streams are also BodyInit but hard to detect here.
  return false;
}

/**
 * Returns true if `url` looks like an absolute URL (protocol or //).
 * Mirrors axios' isAbsoluteURL helper.
 */
function isAbsoluteURL(url: string): boolean {
  return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
}

/**
 * Join baseURL and relativeURL according to axios semantics:
 * - Removes trailing slashes from base
 * - Removes leading slashes from relative
 * - Always joins with exactly one "/"
 *
 * This differs from the WHATWG URL constructor: a leading "/" on the
 * relative URL must NOT drop the baseURL's path prefix.
 */
function combineURLs(baseURL: string, relativeURL: string): string {
  if (!relativeURL) return baseURL;
  return `${baseURL.replace(/\/+$/, "")}/${relativeURL.replace(/^\/+/, "")}`;
}

/**
 * Build a Headers instance from a permissive "axios-like" headers object.
 * - Accepts string, number, boolean, and arrays of those.
 * - Normalizes everything to strings.
 * - When an array is provided, uses multiple header values (append).
 */
function buildHeadersFromAxiosHeaders(
  headersLike: Record<string, unknown> | undefined,
): Headers {
  const headers = new Headers();
  if (!headersLike) return headers;

  for (const [key, raw] of Object.entries(headersLike)) {
    if (raw == null) continue;

    const appendValue = (v: unknown) => {
      // Avoid "[object Object]" — only allow primitives; fallback to JSON for objects
      if (typeof v === "string") headers.append(key, v);
      else if (typeof v === "number" || typeof v === "boolean")
        headers.append(key, String(v));
      else if (v instanceof Date) headers.append(key, v.toUTCString());
      else headers.append(key, JSON.stringify(v));
    };

    if (Array.isArray(raw)) {
      for (const item of raw) appendValue(item);
    } else {
      appendValue(raw);
    }
  }

  return headers;
}

/**
 * Construct a minimal Axios-like error with a synthetic response.
 * Includes all properties that axios expects for proper error handling.
 */
function makeAxiosError(
  message: string,
  config: MinimalAxiosConfig,
  response: MinimalAxiosResponse,
  code?: string,
): MinimalAxiosError {
  const error = new Error(message);
  const err: MinimalAxiosError = Object.assign(error, {
    isAxiosError: true as const,
    response,
    config,
    code: code || "ERR_BAD_RESPONSE",
    request: null,
    toJSON(): Record<string, unknown> {
      return {
        message: error.message,
        name: error.name,
        code: code || "ERR_BAD_RESPONSE",
        config,
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data,
        },
      };
    },
  });
  return err;
}

// ------------------------------------------------------------
// Adapter
// ------------------------------------------------------------

/**
 * Axios adapter using direct adapter override.
 *
 * Works with real axios instances by completely replacing the native transport
 * adapter (http/https in Node, XHR in browsers) with our own implementation.
 *
 * Behavior for unhandled requests:
 * - "warn": log and pass through to original axios transport
 * - "bypass": silently pass through to original axios transport
 * - "error": reject with a 501-like AxiosError
 *
 * Type compatibility:
 * - Accepts both a minimal, stubbed instance (our types) and a real
 *   `axios.AxiosInstance` without adding a runtime dependency on axios.
 */
export function createAxiosAdapter(instance: AxiosLikeInstance): Adapter {
  let isAttached = false;
  let originalAdapter: AxiosAdapterFn | null | undefined = null;

  /**
   * Convert a Fetch Response -> AxiosResponse (structure expected by axios).
   * Robust Content-Type handling:
   * - Treat any content type that *contains* "json" as JSON (e.g. application/hal+json)
   * - text/* -> text()
   * - otherwise -> arrayBuffer()
   */
  async function responseToAxios(
    config: MinimalAxiosConfig | unknown,
    res: Response,
  ): Promise<MinimalAxiosResponse> {
    const ct = res.headers.get("content-type") || "";
    const lower = ct.toLowerCase();
    const data: unknown = lower.includes("json")
      ? await res.json()
      : lower.startsWith("text/")
        ? await res.text()
        : await res.arrayBuffer();

    return {
      data,
      status: res.status,
      statusText: res.statusText || String(res.status),
      headers: Object.fromEntries(res.headers.entries()),
      config: config as MinimalAxiosConfig,
      request: null,
    };
  }

  /**
   * Safely read `instance.defaults.baseURL` regardless of whether the provided
   * instance is a real axios instance or a stub.
   */
  const getInstanceBaseURL = (): string | undefined => {
    const i = instance as CompatibleAxiosInstance;
    return i?.defaults?.baseURL;
  };

  /**
   * Build a WHATWG Request from axios config + base URLs.
   *
   * Respects (axios semantics):
   * - config.baseURL (highest precedence)
   * - instance.defaults.baseURL (next)
   * - config.params are serialized and merged with URL query string
   * If none provided:
   * - keep `config.url` as-is (relative like "/v1/x" allowed) and let the core
   *   resolve against intercept.origin(...).
   *
   * Also builds headers robustly from "axios-like" shapes (arrays, numbers, booleans).
   */
  function axiosConfigToRequest(config: MinimalAxiosConfig): Request {
    const candidateBase =
      (config.baseURL as string | undefined) ?? getInstanceBaseURL();

    let fullUrl = (config.url ?? "").toString();

    if (isAbsoluteURL(fullUrl)) {
      // use as-is
    } else if (candidateBase) {
      fullUrl = combineURLs(candidateBase, fullUrl);
    } else {
      // No axios baseURL — try active intercept.origin as the fallback for relative URLs.
      const active = getOrigin();
      if (active) {
        fullUrl = combineURLs(active, fullUrl);
      } else {
        // Last resort: mark as "relative" via sentinel origin so core can still reason about it.
        fullUrl = new URL(fullUrl, REL_BASE).toString();
      }
    }

    // Handle axios params: serialize and merge with existing query string
    if (config.params && typeof config.params === "object") {
      const url = new URL(fullUrl, REL_BASE);
      const params = config.params as Record<string, unknown>;

      for (const [key, value] of Object.entries(params)) {
        if (value != null) {
          // Axios serializes arrays by repeating the key
          if (Array.isArray(value)) {
            for (const item of value) {
              url.searchParams.append(key, String(item));
            }
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      }

      fullUrl = url.toString();
    }

    const method = String(config.method || "get").toUpperCase();
    const headers = buildHeadersFromAxiosHeaders(
      (config.headers ?? {}) as Record<string, unknown>,
    );

    let body: BodyInit | null = null;
    if (config.data != null && method !== "GET" && method !== "HEAD") {
      if (isBodyInit(config.data)) {
        body = config.data;
      } else {
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
        body = JSON.stringify(config.data);
      }
    }

    return new Request(fullUrl, { method, headers, body });
  }

  return {
    attach(core: CoreForAdapter) {
      if (isAttached) return;

      // Narrow to a structurally compatible form
      const anyInst = instance as CompatibleAxiosInstance;

      // Store the original adapter (it's an array by default: ['xhr', 'http', 'fetch'])
      originalAdapter = anyInst.defaults.adapter;

      // CRITICAL: Set adapter SYNCHRONOUSLY before any requests are made
      // Axios caches adapter selection on first request, so we must replace it immediately
      anyInst.defaults.adapter = async (
        config: MinimalAxiosConfig,
      ): Promise<MinimalAxiosResponse> => {
        // Convert axios config to Request and check if we should mock it
        const req = axiosConfigToRequest(config);
        const result = await core.tryHandle(req);

        if (result.matched) {
          // We have a mock! Return it directly as an AxiosResponse
          return responseToAxios(config, result.res);
        }

        // No mock found - handle unhandled request strategy
        const urlForLogs = isAbsoluteURL(req.url)
          ? new URL(req.url)
          : new URL(req.url, "http://origin.invalid");

        const strategy = resolveStrategy(core.getOptions().onUnhandledRequest, {
          request: req,
          url: urlForLogs,
        });

        if (strategy === "warn") {
          core.logUnhandled("warn", req, urlForLogs);
          // Pass through to original adapter if available
          if (originalAdapter) {
            return originalAdapter(config);
          }
          // No original adapter - return error
          const errorResponse = await responseToAxios(
            config,
            HttpResponse.json(
              {
                error: "No original adapter available",
                message: "Cannot pass through unhandled request",
              },
              { status: 500 },
            ),
          );
          throw makeAxiosError(
            "No original adapter available (warn mode)",
            config,
            errorResponse,
          );
        }

        if (strategy === "bypass") {
          // Silently pass through to original adapter if available
          if (originalAdapter) {
            return originalAdapter(config);
          }
          // No original adapter - return error
          const errorResponse = await responseToAxios(
            config,
            HttpResponse.json(
              {
                error: "No original adapter available",
                message: "Cannot pass through unhandled request",
              },
              { status: 500 },
            ),
          );
          throw makeAxiosError(
            "No original adapter available (bypass mode)",
            config,
            errorResponse,
          );
        }

        // strategy === "error" - block the request
        core.logUnhandled("error", req, urlForLogs);
        const errorResponse = await responseToAxios(
          config,
          HttpResponse.json(
            {
              error: "Unhandled request",
              details: {
                method: req.method,
                url: urlForLogs.toString(),
                headers: headersToObject(req.headers),
              },
            },
            { status: 501 },
          ),
        );

        throw makeAxiosError(
          "Request blocked by test server (unhandled)",
          config,
          errorResponse,
        );
      };

      isAttached = true;
    },

    detach() {
      if (!isAttached) return;

      const anyInst = instance as CompatibleAxiosInstance;

      // Restore the original adapter
      if (originalAdapter !== undefined) {
        anyInst.defaults.adapter = originalAdapter;
        originalAdapter = null;
      }

      isAttached = false;
    },
  };
}
