// --------- Minimal Axios typings (no `any`) ----------
/** biome-ignore-all lint/suspicious/noTsIgnore: <allow missing axios types> */
/** biome-ignore-all lint/suspicious/noExplicitAny: <allow missing axios types> */

/**
 * Permissive header value type that accepts common shapes users might provide.
 * We normalize these into a WHATWG Headers instance at the adapter boundary.
 *
 * This is intentionally more permissive than axios's AxiosHeaderValue to:
 * - Allow numbers (e.g., Content-Length: 1234)
 * - Allow booleans (e.g., X-Feature-Enabled: true)
 * - Allow arrays for multi-value headers (e.g., Set-Cookie: ["a", "b"])
 */
type MinimalAxiosHeaderValue =
  | string
  | number
  | boolean
  | Date
  | unknown
  | Array<string | number | boolean | Date | unknown>;

/**
 * Header map type - intentionally more flexible than axios's AxiosHeaders.
 * The adapter normalizes this to WHATWG Headers internally.
 */
type MinimalAxiosHeaders = Record<string, MinimalAxiosHeaderValue>;

/**
 * Minimal axios request configuration.
 *
 * This type includes only the most commonly-used config options to keep
 * the adapter lightweight and dependency-free. Omitted options include:
 * - transformRequest/transformResponse (handled by adapter)
 * - adapter (we override this)
 * - cancelToken/signal (different cancellation model)
 * - onUploadProgress/onDownloadProgress (not supported)
 * - proxy, xsrf, maxContentLength, etc. (Node-specific or not needed)
 *
 * @template T - Type of the request data
 */
export type MinimalAxiosConfig = {
  /** Request URL (relative or absolute) */
  url?: string;
  /** Base URL to prepend to `url` (unless `url` is absolute) */
  baseURL?: string;
  /** HTTP method (GET, POST, PUT, PATCH, DELETE, etc.) */
  method?: string;
  /** Request headers - accepts flexible value types that are normalized internally */
  headers?: MinimalAxiosHeaders;
  /** Request body data (any serializable value) */
  data?: unknown;
  /** URL query parameters as key-value pairs */
  params?: Record<string, unknown>;
  /** Custom function to determine if status code is valid (default: 2xx) */
  validateStatus?: (status: number) => boolean;
};

/**
 * Minimal axios response structure.
 *
 * Matches the essential fields of axios's AxiosResponse to ensure compatibility
 * with user code that expects axios-shaped responses.
 *
 * @template T - Type of the response data
 */
export type MinimalAxiosResponse<T = unknown> = {
  /** Response data (parsed from JSON if Content-Type indicates JSON) */
  data: T;
  /** HTTP status code (200, 404, 500, etc.) */
  status: number;
  /** HTTP status text (OK, Not Found, Internal Server Error, etc.) */
  statusText: string;
  /** Response headers as a plain object */
  headers: Record<string, string>;
  /** The config used for this request */
  config: MinimalAxiosConfig;
  /** The underlying request object (usually null in our adapter) */
  request: unknown;
};

/**
 * Adapter function type - transforms a config into a response.
 * This is the function type that we replace in axios's `defaults.adapter`.
 */
export type AxiosAdapterFn = (
  config: MinimalAxiosConfig,
) => Promise<MinimalAxiosResponse>;

/**
 * Minimal axios instance structure.
 *
 * Includes only the fields we need to read/write for adapter integration.
 * Real axios instances have many more methods and properties.
 */
export type MinimalAxiosInstance = {
  defaults: {
    /** The adapter function (or array of adapters in real axios) */
    adapter?: AxiosAdapterFn | undefined;
    /** Base URL for all requests */
    baseURL?: string | undefined;
  };
  /** Method to make requests (we don't call this, but axios instances have it) */
  request: (config: MinimalAxiosConfig) => Promise<MinimalAxiosResponse>;
};

/**
 * Minimal axios error structure.
 *
 * Matches the essential fields of axios's AxiosError to ensure proper error
 * handling in user code. Includes all properties that axios error handlers
 * typically check.
 *
 * Key properties:
 * - `isAxiosError`: Flag to identify axios errors (always true)
 * - `response`: The response that caused the error (if any)
 * - `config`: The config used for the failed request
 * - `code`: Optional error code (ERR_BAD_RESPONSE, ERR_NETWORK, etc.)
 * - `request`: The underlying request object
 * - `toJSON`: Method to serialize the error for logging/debugging
 *
 * Plus all standard Error properties (message, name, stack).
 *
 * @template T - Type of the response data
 */
export type MinimalAxiosError<T = unknown> = Error & {
  /** Flag to identify this as an axios error */
  isAxiosError: true;
  /** The response that caused this error (if server responded) */
  response: MinimalAxiosResponse<T>;
  /** The request config that was used */
  config: MinimalAxiosConfig;
  /** Optional error code (e.g., ERR_BAD_RESPONSE, ERR_NETWORK) */
  code?: string;
  /** The underlying request object (usually null in our adapter) */
  request?: unknown;
  /** Serialization method for logging/debugging */
  toJSON?: () => Record<string, unknown>;
};

// --------- Compatibility layer for real axios (type-only) ----------

/**
 * A loose adapter function type so we can store either a real axios adapter
 * or our stub adapter without importing axios at runtime.
 */
type AnyAxiosAdapter = (config: any) => Promise<any>;

/**
 * A structural instance type that both a real AxiosInstance and our stub match.
 * We only read/write `defaults.adapter` and read `defaults.baseURL`.
 */
export interface CompatibleAxiosInstance {
  defaults: {
    adapter?: AnyAxiosAdapter | null;
    baseURL?: string;
  };
  interceptors: {
    request: {
      use: (
        onFulfilled: (config: any) => any,
        onRejected?: (error: any) => any,
      ) => number;
      eject: (id: number) => void;
    };
    response: {
      use: (
        onFulfilled: (response: any) => any,
        onRejected?: (error: any) => any,
      ) => number;
      eject: (id: number) => void;
    };
  };
}

/**
 * Union that accepts either our compatible shape or a real axios instance,
 * without creating a runtime dependency on axios. The conditional `import()`
 * is erased at compile-time if axios types are not present.
 */
export type AxiosLikeInstance =
  | CompatibleAxiosInstance
  // @ts-ignore: allow missing axios types
  | import("axios").AxiosInstance;

/**
 * Type guard to check if a value is an axios-like instance.
 * Checks for the minimal structure needed for our adapter.
 */
export function isAxiosLikeInstance(
  value: unknown,
): value is AxiosLikeInstance {
  // Axios instances are functions with properties, so accept both 'object' and 'function'
  if (
    value == null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  // Must have a defaults object
  if (
    !candidate.defaults ||
    typeof candidate.defaults !== "object" ||
    candidate.defaults === null
  ) {
    return false;
  }

  // Must have a request method
  if (typeof candidate.request !== "function") {
    return false;
  }

  return true;
}
