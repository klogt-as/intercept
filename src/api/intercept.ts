import { server } from "../core/server";
import type {
  HttpMethod,
  JsonBodyType,
  JsonHeaders,
  Path,
} from "../core/types";
import { HttpResponse } from "../http/response";

/**
 * Shape of a dynamic resolver. You get the raw `Request`, the parsed `URL`,
 * extracted path `params`, and (best-effort) parsed JSON `body`.
 */
export type DynamicResolver<TRequest = unknown> = (args: {
  request: Request;
  url: URL;
  params: Record<string, string>;
  body: TRequest | undefined;
}) => Response | Promise<Response>;

/** Default HTTP status per method when returning a successful result. */
const DEFAULT_STATUS: Record<HttpMethod, number> = {
  GET: 200,
  POST: 201,
  PUT: 200,
  PATCH: 200,
  DELETE: 204,
  OPTIONS: 200,
};

/**
 * Internal: register a handler with the underlying server.
 * Kept minimal to ensure compatibility with your `server.use`.
 */
function register(
  method: HttpMethod,
  path: Path,
  handler: (ctx: {
    request: Request;
    url: URL;
    params: Record<string, string>;
  }) => Response | Promise<Response>
) {
  server.use(method, path, handler);
}

/**
 * Attempt to parse JSON from the request body (best-effort).
 * Returns `undefined` if the body is empty or not JSON.
 */
async function toResolverArgs<TReq>(
  request: Request,
  url: URL,
  params: Record<string, string>
) {
  let body: TReq | undefined;
  try {
    body = (await request.clone().json()) as TReq;
  } catch {
    // Non-JSON or empty body is fine.
  }
  return { request, url, params, body };
}

/** Optional init for successful JSON responses. */
export type ResolveInit = {
  /**
   * HTTP status to use. If omitted, a method-appropriate default is used (e.g. 201 for POST).
   * If you pick 204, the body will be ignored and a `null` body will be sent.
   */
  status?: number;
  /** Additional response headers. */
  headers?: JsonHeaders;
};

/**
 * Optional init for error responses.
 * @template T JSON type for the error body (or `undefined` for no body).
 */
export type RejectInit<T extends JsonBodyType | undefined = JsonBodyType> = {
  /** An error status like 400, 401, 403, 404, 409, 422, 500, ... */
  status?: number;
  /** Optional JSON body for the error. Use `undefined` for no body. */
  body?: T;
  /** Additional response headers. */
  headers?: JsonHeaders;
};

/** Optional init for pending/loading simulation. */
export type FetchingInit = {
  /**
   * Delay (ms) before resolving. If omitted, the promise never resolves to simulate an indefinitely pending request.
   */
  delayMs?: number;
  /**
   * Status to use when resolving after `delayMs`. Defaults to 204 (No Content).
   * Note: Node/undici does not allow sending 1xx from userland.
   */
  status?: number;
  /** Additional response headers when resolving after `delayMs`. */
  headers?: JsonHeaders;
};

/** Small utility: a never-resolving promise (simulates "in-flight" forever). */
const never: Promise<Response> = new Promise(() => {});

/**
 * Builds the fluent API for a given HTTP method.
 * Exposes: `resolve`, `reject`, `fetching`, and `handle`.
 */
function addInterceptFor(method: HttpMethod) {
  return (path: Path) => {
    /**
     * Build a ResponseInit without explicitly setting undefined properties.
     * This avoids exactOptionalPropertyTypes issues (headers?: HeadersInit).
     */
    const makeInit = (status: number, headers?: JsonHeaders): ResponseInit =>
      headers ? { status, headers } : { status };

    /**
     * Ensure the right behavior for 204: strip the body if the caller provides one.
     * Also omit `headers` from the init when undefined (to satisfy exactOptionalPropertyTypes).
     */
    const respondSuccess = <T extends JsonBodyType>(
      json: T,
      init: ResolveInit
    ) => {
      const status = init.status ?? DEFAULT_STATUS[method];

      // If status implies no content, force null body.
      if (status === 204) {
        return new HttpResponse(null, makeInit(status, init.headers));
      }
      return HttpResponse.json(json, makeInit(status, init.headers));
    };

    return {
      /**
       * Resolve this route with a successful JSON response.
       *
       * @example
       * intercept.get('/users').resolve([{ id: 1 }])
       *
       * @param json JSON body to return (ignored if status=204).
       * @param init Optional overrides like `status` or custom `headers`.
       *             Note: `headers` is omitted from ResponseInit when undefined
       *             to comply with `exactOptionalPropertyTypes: true`.
       */
      resolve<T extends JsonBodyType>(json: T, init: ResolveInit = {}) {
        register(method, path, () => respondSuccess(json, init));
      },

      /**
       * Reject this route with an error HTTP status and optional JSON error body.
       *
       * @example
       * intercept.post('/login').reject({ status: 401, body: { code: 'UNAUTHORIZED' } })
       *
       * @param opts Error options (status default is 400).
       *             Note: `headers` is omitted from ResponseInit when undefined
       *             to comply with `exactOptionalPropertyTypes: true`.
       */
      reject<T extends JsonBodyType | undefined = JsonBodyType>(
        opts: RejectInit<T> = {}
      ) {
        const status = opts.status ?? 400;
        register(method, path, () => {
          if (opts.body === undefined) {
            return new HttpResponse(null, makeInit(status, opts.headers));
          }
          return HttpResponse.json(
            opts.body as Exclude<T, undefined>,
            makeInit(status, opts.headers)
          );
        });
      },

      /**
       * Simulate a pending/fetching state.
       *
       * - If `delayMs` is omitted, the promise never resolves (request hangs).
       * - If `delayMs` is provided, resolves after that delay with the provided
       *   `status` (default 204) and optional `headers`.
       *
       * @example
       * // never resolves
       * intercept.get('/slow').fetching();
       *
       * @example
       * // resolves after 800ms with 204
       * intercept.get('/slow').fetching({ delayMs: 800 });
       */
      fetching(init: FetchingInit = {}) {
        const { delayMs, status = 204, headers } = init;
        register(method, path, () => {
          if (delayMs === undefined) return never; // hang forever
          return new Promise<Response>((resolve) => {
            setTimeout(
              () => resolve(new HttpResponse(null, makeInit(status, headers))),
              Math.max(0, delayMs)
            );
          });
        });
      },

      /**
       * Full control: supply a custom resolver. You receive parsed JSON body
       * (best-effort) plus the raw `Request`, `URL`, and `params`.
       *
       * @example
       * intercept.post('/users').handle(async ({ body }) => {
       *   if (!body || typeof body !== 'object') {
       *     return HttpResponse.json({ error: 'Invalid' }, { status: 400 });
       *   }
       *   return HttpResponse.json({ id: 1 }, { status: 201 });
       * });
       */
      handle<TReq = unknown>(resolver: DynamicResolver<TReq>) {
        register(method, path, async ({ request, url, params }) => {
          const args = await toResolverArgs<TReq>(request, url, params);
          return resolver(args);
        });
      },
    };
  };
}

/**
 * Public fluent API: chain by method and path, then choose a terminal action:
 * `.resolve(...)`, `.reject(...)`, `.fetching(...)`, or `.handle(...)`.
 *
 * @example
 * intercept.get('/todos').resolve([{ id: 1 }]);
 * intercept.post('/todos').reject({ status: 422, body: { message: 'Invalid' } });
 * intercept.get('/slow').fetching({ delayMs: 1000 });
 * intercept.patch('/todos/:id').handle(({ params, body }) => { ... });
 */
export const intercept = {
  get: addInterceptFor("GET"),
  post: addInterceptFor("POST"),
  put: addInterceptFor("PUT"),
  patch: addInterceptFor("PATCH"),
  delete: addInterceptFor("DELETE"),
  options: addInterceptFor("OPTIONS"),
};
