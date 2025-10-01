import { resetActiveOrigin, setActiveOrigin } from "../core/origin";
import { server } from "../core/server";
import type {
  HttpMethod,
  JsonBodyType,
  JsonHeaders,
  ListenOptions,
  Path,
} from "../core/types";
import { HttpResponse } from "../http/response";

/**
 * Shape of a dynamic resolver. You get the raw `Request`, the parsed `URL`,
 * extracted path `params`, and (best-effort) parsed JSON `body`.
 */
type DynamicResolver<TRequest = unknown> = (args: {
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
 * Guard that ensures .listen() has been called before route registration.
 * This provides a strong DX message if a user forgets to set up intercept first.
 */
function assertListening() {
  if (!server.isListening()) {
    throw new Error(
      `[@klogt/intercept] You must call intercept.listen(...) before registering routes. ` +
        `Do this in setupTests.ts or in this file's beforeAll. Example:\n` +
        `  beforeAll(() => {\n` +
        `    intercept.listen({ onUnhandledRequest: 'error' })\n` +
        `           .origin('https://api.example.com');\n` +
        `  });`,
    );
  }
}

/**
 * Internal: register a handler with the underlying server.
 * Kept minimal to ensure compatibility with server.use.
 */
function register(
  method: HttpMethod,
  path: Path,
  handler: (ctx: {
    request: Request;
    url: URL;
    params: Record<string, string>;
  }) => Response | Promise<Response>,
) {
  assertListening();
  server.use(method, path, handler);
}

/**
 * Attempt to parse JSON from the request body (best-effort).
 * Returns `undefined` if the body is empty or not JSON.
 */
async function toResolverArgs<TReq>(
  request: Request,
  url: URL,
  params: Record<string, string>,
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
type ResolveInit = {
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
type RejectInit<T extends JsonBodyType | undefined = JsonBodyType> = {
  /** An error status like 400, 401, 403, 404, 409, 422, 500, ... */
  status?: number;
  /** Optional JSON body for the error. Use `undefined` for no body. */
  body?: T;
  /** Additional response headers. */
  headers?: JsonHeaders;
};

/** Optional init for pending/loading simulation. */
type FetchingInit = {
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
  return <P extends Path>(path: P) => {
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
      init: ResolveInit,
    ) => {
      const status = init.status ?? DEFAULT_STATUS[method];

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
       *   // Relative path
       *   intercept.get('/users').resolve([{ id: 1 }]);
       *
       *   // Absolute URL (highest priority)
       *   intercept.get('https://payments.example.com/v1/charges')
       *            .resolve({ ok: true });
       */
      resolve<T extends JsonBodyType>(json: T, init: ResolveInit = {}) {
        register(method, path, () => respondSuccess(json, init));
      },

      /**
       * Reject this route with an error HTTP status and optional JSON error body.
       *
       * @example
       * intercept.post('/login').reject({ status: 401, body: { code: 'UNAUTHORIZED' } })
       */
      reject<T extends JsonBodyType | undefined = JsonBodyType>(
        opts: RejectInit<T> = {},
      ) {
        const status = opts.status ?? 400;
        register(method, path, () => {
          if (opts.body === undefined) {
            return new HttpResponse(null, makeInit(status, opts.headers));
          }
          return HttpResponse.json(
            opts.body as Exclude<T, undefined>,
            makeInit(status, opts.headers),
          );
        });
      },

      /**
       * Simulate a pending/fetching state.
       *
       * - If `delayMs` is omitted, the promise never resolves (request hangs).
       * - If `delayMs` is provided, resolves after that delay with the provided
       *   `status` (default 204) and optional `headers`.
       */
      fetching(init: FetchingInit = {}) {
        const { delayMs, status = 204, headers } = init;
        register(method, path, () => {
          if (delayMs === undefined) return never; // hang forever
          return new Promise<Response>((resolve) => {
            setTimeout(
              () => resolve(new HttpResponse(null, makeInit(status, headers))),
              Math.max(0, delayMs),
            );
          });
        });
      },

      /**
       * Full control: supply a custom resolver. You receive parsed JSON body
       * (best-effort) plus the raw `Request`, `URL`, and `params`.
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
 * Public fluent API
 */

export const intercept = {
  // Route builders
  get: addInterceptFor("GET"),
  post: addInterceptFor("POST"),
  put: addInterceptFor("PUT"),
  patch: addInterceptFor("PATCH"),
  delete: addInterceptFor("DELETE"),
  options: addInterceptFor("OPTIONS"),

  /**
   * Start or update intercept. baseUrl is intentionally unsupported everywhere.
   * Returns `this` to allow chaining `.origin(...)`.
   */
  listen(options: ListenOptions) {
    server.listen({ onUnhandledRequest: options.onUnhandledRequest });
    return this as typeof intercept;
  },

  /**
   * Ignore (silence) requests to the given paths across **all HTTP methods**.
   * Must be called after listen().
   */
  ignore(paths: ReadonlyArray<Path>) {
    assertListening();
    const methods: HttpMethod[] = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ];
    for (const p of paths) {
      for (const m of methods) {
        server.use(m, p as Path, () => new HttpResponse(null, { status: 204 }));
      }
    }
  },

  /**
   * Set the active origin for relative paths in this test file/run and
   * return the intercept API so you can fluently chain route declarations.
   *
   * Can be called in beforeAll (applies to the whole file) or in beforeEach.
   * Absolute URLs ignore origin.
   */
  origin(origin: string) {
    setActiveOrigin(origin);
    return this as typeof intercept;
  },

  /**
   * Reset all routes.
   * Use in afterEach.
   */
  reset() {
    server.resetHandlers();
  },

  /**
   * Detach adapters, restore globals, and clear all state.
   * Use in afterAll.
   */
  close() {
    server.close();
  },

  /** Internal/testing helper: clear per-test origin (called automatically on reset). */
  _clearOriginForTestOnly() {
    resetActiveOrigin();
  },
};
