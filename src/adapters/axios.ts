import type { Adapter, CoreForAdapter } from "../core/types";
import { headersToObject, resolveStrategy } from "../core/utils";
import { HttpResponse } from "../http/response";
import type {
  AxiosAdapterFn,
  MinimalAxiosConfig,
  MinimalAxiosError,
  MinimalAxiosInstance,
  MinimalAxiosResponse,
} from "./types";

// BodyInit guard for axios data -> fetch body
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
  // Node ReadableStream/WHATWG streams are also BodyInit but hard to guard here; skip.
  return false;
}

/**
 * Axios adapter: wraps an axios instance's low-level adapter.
 * Compatible with axios v1. It overrides `instance.defaults.adapter`
 * while attached and restores it on detach.
 *
 * Behavior mirrors fetch adapter for unhandled requests:
 * - "warn": log and call the original axios adapter
 * - "bypass": call the original axios adapter
 * - "error": reject with a 501-like AxiosError
 */
export function createAxiosAdapter(instance: MinimalAxiosInstance): Adapter {
  let originalAdapter: AxiosAdapterFn | null = null;

  // Convert Fetch Response -> AxiosResponse
  async function responseToAxios(
    config: MinimalAxiosConfig,
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
      config,
      request: null,
    };
  }

  // Build a WHATWG Request from axios config
  function axiosConfigToRequest(
    config: MinimalAxiosConfig,
    baseUrl: string
  ): Request {
    // axios resolves url as: new URL(config.url, config.baseURL)
    const fullUrl = new URL(
      config.url ?? "",
      config.baseURL ?? baseUrl
    ).toString();
    const method = String(config.method || "get").toUpperCase();
    const headers = new Headers((config.headers ?? {}) as HeadersInit);
    let body: BodyInit | undefined;

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
      originalAdapter = instance.defaults.adapter ?? null;

      instance.defaults.adapter = async (config: MinimalAxiosConfig) => {
        const req = axiosConfigToRequest(config, core.getOptions().baseUrl);
        const url = new URL(req.url, core.getOptions().baseUrl);

        const result = await core.tryHandle(req);
        if (result.matched) {
          return responseToAxios(config, result.res);
        }

        // Unhandled
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
      if (originalAdapter !== null) {
        instance.defaults.adapter = originalAdapter;
        originalAdapter = null;
      }
    },
  };
}
