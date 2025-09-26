/** biome-ignore-all lint/suspicious/noExplicitAny: <allow missing axios types> */
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
 * Type compatibility:
 * - Accepts both a minimal, stubbed instance (our types) and a real
 *   `axios.AxiosInstance` without adding a runtime dependency on axios.
 */
export function createAxiosAdapter(instance: AxiosLikeInstance): Adapter {
  // Løst-typet original adapter slik at vi kan håndtere både ekte axios og stub
  let originalAdapter: AnyAxiosAdapter | null = null;

  /**
   * Convert a Fetch Response -> AxiosResponse (structure expected by axios).
   * We stick to our minimal wire-format so we don't depend on axios' internal types.
   */
  async function responseToAxios(
    config: MinimalAxiosConfig | any,
    res: Response
  ): Promise<MinimalAxiosResponse> {
    const ct = res.headers.get("content-type") || "";
    const data: unknown = ct.includes("application/json")
      ? await res.json()
      : ct.startsWith("text/")
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
   * Respects:
   * - config.baseURL (highest precedence)
   * - instance.defaults.baseURL (next)
   * - serverBaseUrl (fallback from server.listen)
   *
   * Axios semantics are preserved: relative URL joined with baseURL,
   * leading "/" does NOT drop the base path prefix.
   */
  function axiosConfigToRequest(
    config: MinimalAxiosConfig,
    serverBaseUrl: string
  ): Request {
    const candidateBase =
      (config.baseURL as string | undefined) ??
      getInstanceBaseURL() ??
      serverBaseUrl;

    let fullUrl = (config.url ?? "").toString();

    if (isAbsoluteURL(fullUrl)) {
      // Absolute URLs are used as-is
    } else if (candidateBase) {
      fullUrl = combineURLs(candidateBase, fullUrl);
    }

    const method = String(config.method || "get").toUpperCase();
    const headers = new Headers((config.headers ?? {}) as HeadersInit);

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

      // Narrow til en strukturelt kompatibel form og lagre original adapter
      const anyInst = instance as CompatibleAxiosInstance;
      originalAdapter = anyInst.defaults.adapter ?? null;

      anyInst.defaults.adapter = async (config: any) => {
        // NB: `config` er `any` her for å støtte både ekte axios og stub.
        const req = axiosConfigToRequest(
          config as MinimalAxiosConfig,
          core.getOptions().baseUrl
        );
        const url = new URL(req.url, core.getOptions().baseUrl);

        const result = await core.tryHandle(req);
        if (result.matched) {
          return responseToAxios(config, result.res);
        }

        // Unhandled request
        const strategy = resolveStrategy(core.getOptions().onUnhandledRequest, {
          request: req,
          url,
        });
        if (strategy === "warn") {
          core.logUnhandled("warn", req, url);
          return originalAdapter
            ? originalAdapter(config)
            : responseToAxios(
                config,
                HttpResponse.json(
                  { error: "No axios adapter configured" },
                  { status: 500 }
                )
              );
        }
        if (strategy === "bypass") {
          return originalAdapter
            ? originalAdapter(config)
            : responseToAxios(
                config,
                HttpResponse.json(
                  { error: "No axios adapter configured" },
                  { status: 500 }
                )
              );
        }

        // error -> reject like axios would on HTTP error
        core.logUnhandled("error", req, url);
        const res = HttpResponse.json(
          {
            error: "Unhandled request",
            details: {
              method: req.method,
              url: url.toString(),
              headers: headersToObject(req.headers),
            },
          },
          { status: 501 }
        );
        const axiosRes = await responseToAxios(config, res);

        const err: MinimalAxiosError = Object.assign(
          new Error("Request blocked by test server (unhandled)"),
          {
            isAxiosError: true as const,
            response: axiosRes,
            config,
          }
        );
        throw err;
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
