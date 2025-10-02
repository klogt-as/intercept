export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type Path = `/${string}` | `http://${string}` | `https://${string}`;
export type JsonHeaders = Record<string, string>;
export type JsonBodyType = unknown;

/**
 * Extract path parameter names from a path string.
 *
 * @example
 * ExtractPathParams<"/users/:id"> => { id: string }
 * ExtractPathParams<"/users/:userId/posts/:postId"> => { userId: string; postId: string }
 * ExtractPathParams<"/users"> => {}
 */
export type ExtractPathParams<T extends string> = string extends T
  ? Record<string, string> // fallback for non-literal strings
  : T extends `${infer _Start}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractPathParams<Rest>]: string }
    : T extends `${infer _Start}:${infer Param}`
      ? { [K in Param]: string }
      : Record<string, never>;

/**
 * Strategy to use when a request is not handled by any registered route.
 *
 * - "warn": Log a warning, then delegate to the real transport (bypass).
 * - "bypass": Silently delegate to the real transport.
 * - "error": Do NOT delegate, instead return a 501 response (or throw in adapters that expect errors).
 * - function: Decide dynamically per request; must return one of the above strings.
 */
export type OnUnhandledRequestStrategy =
  | "warn"
  | "error"
  | "bypass"
  | ((args: {
      request: Request;
      url: URL;
    }) => undefined | "warn" | "error" | "bypass");

/**
 * Options for `server.listen`.
 */
export type ListenOptions = {
  /** What to do when no handler matches the request (default: auto-detected based on environment). */
  onUnhandledRequest?: OnUnhandledRequestStrategy;
  /** Optional origin to set for relative paths (e.g., "https://api.example.com"). Can be updated later with .origin(). */
  origin?: string;
  /** Optional axios-like instance to attach as an adapter. */
  adapter?: unknown; // Will be type-narrowed at runtime
};

// Discriminated union for core dispatch:
export type TryHandleResult =
  | { matched: true; res: Response }
  | { matched: false };

// Adapter management
export type CoreForAdapter = {
  tryHandle: (req: Request) => Promise<TryHandleResult>;
  getOptions: () => {
    onUnhandledRequest?: OnUnhandledRequestStrategy | undefined;
  };
  getRegisteredHandlers: () => Array<{ method: HttpMethod; path: Path }>;
  logUnhandled: (
    kind: "warn" | "error",
    req: Request,
    url: URL,
    registeredHandlers?: Array<{ method: HttpMethod; path: Path }>,
  ) => void;
};

export type Adapter = {
  /**
   * Attach the adapter. The adapter will be given a callback to invoke our core
   * dispatcher, and a function to resolve the onUnhandled strategy / baseUrl.
   */
  attach(core: CoreForAdapter): void;
  /** Detach / restore original behavior. */
  detach(): void;
};
