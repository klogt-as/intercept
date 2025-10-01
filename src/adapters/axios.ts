import { getOrigin } from "../core/store";
import type { Adapter, CoreForAdapter } from "../core/types";
import { headersToObject, resolveStrategy } from "../core/utils";
import { HttpResponse } from "../http/response";
import type {
  AnyAxiosAdapter,
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
 */
function makeAxiosError(
  message: string,
  config: MinimalAxiosConfig,
  response: MinimalAxiosResponse,
): MinimalAxiosError {
  const err: MinimalAxiosError = Object.assign(new Error(message), {
    isAxiosError: true as const,
    response,
    config,
  });
  return err;
}

// ------------------------------------------------------------
// Adapter
// ------------------------------------------------------------

/**
 * Axios adapter: wraps an axios instance's low-level adapter.
 *
 * Compatible with axios v1. It overrides `instance.defaults.adapter`
 * while attached and restores it on detach.
 *
 * Behavior mirrors fetch adapter for unhandled requests:
 * - "warn": log and call the original axios adapter
 * - "bypass": call the original axios adapter
 * - "error": reject with a 501-like AxiosError
 *
 * When "warn"/"bypass" is requested but there is no original adapter,
 * this adapter throws an Axios-like error with a synthetic 500 response.
 *
 * Type compatibility:
 * - Accepts both a minimal, stubbed instance (our types) and a real
 *   `axios.AxiosInstance` without adding a runtime dependency on axios.
 */
export function createAxiosAdapter(instance: AxiosLikeInstance): Adapter {
  // Loosely-typed original adapter so we can handle both real axios and stub
  let originalAdapter: AnyAxiosAdapter | null = null;

  /**
   * Convert a Fetch Response -> AxiosResponse (structure expected by axios).
   * Robust Content-Type handling:
   * - Treat any content type that *contains* "json" as JSON (e.g. application/hal+json)
   * - text/* -> text()
   * - otherwise -> arrayBuffer()
   */
  async function responseToAxios(
    config: MinimalAxiosConfig | any,
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
      if (originalAdapter) return;

      // Narrow to a structurally compatible form and store original adapter
      const anyInst = instance as CompatibleAxiosInstance;
      originalAdapter = anyInst.defaults.adapter ?? null;

      anyInst.defaults.adapter = async (config: any) => {
        // NB: `config` is `any` here to support both real axios and stub.
        const req = axiosConfigToRequest(config as MinimalAxiosConfig);

        const result = await core.tryHandle(req);
        if (result.matched) {
          return responseToAxios(config, result.res);
        }

        // Unhandled request
        // Build a URL object for logging:
        const urlForLogs = isAbsoluteURL(req.url)
          ? new URL(req.url)
          : new URL(req.url, "http://origin.invalid");

        const strategy = resolveStrategy(core.getOptions().onUnhandledRequest, {
          request: req,
          url: urlForLogs,
        });

        if (strategy === "warn" || strategy === "bypass") {
          // In both "warn" and "bypass" we prefer delegating to the original adapter if present.
          if (strategy === "warn") {
            core.logUnhandled("warn", req, urlForLogs);
          }
          if (originalAdapter) {
            return originalAdapter(config);
          }

          // No original adapter available — throw an Axios-like error with synthetic 500
          const synthetic = await responseToAxios(
            config,
            HttpResponse.json(
              { error: "No axios adapter configured for passthrough" },
              { status: 500 },
            ),
          );
          throw makeAxiosError(
            "No axios adapter configured",
            config as MinimalAxiosConfig,
            synthetic,
          );
        }

        // strategy === "error" -> reject like axios would on HTTP error
        core.logUnhandled("error", req, urlForLogs);
        const res = HttpResponse.json(
          {
            error: "Unhandled request",
            details: {
              method: req.method,
              url: urlForLogs.toString(),
              headers: headersToObject(req.headers),
            },
          },
          { status: 501 },
        );
        const axiosRes = await responseToAxios(config, res);

        throw makeAxiosError(
          "Request blocked by test server (unhandled)",
          config as MinimalAxiosConfig,
          axiosRes,
        );
      };
    },
    detach() {
      const anyInst = instance as CompatibleAxiosInstance;
      if (originalAdapter !== null) {
        anyInst.defaults.adapter = originalAdapter;
        originalAdapter = null;
      }
    },
  };
}
