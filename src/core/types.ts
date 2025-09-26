export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type Path = `/${string}` | "/*";
export type JsonHeaders = Record<string, string>;
export type JsonBodyType = unknown;

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
  /**
   * Base URL that inbound requests are compared against.
   * Example: "http://localhost", "http://localhost:5173/api"
   *
   * All requests must share the same origin as `baseUrl` and have a path
   * that starts with `baseUrl`'s pathname to be eligible for matching.
   */
  baseUrl: string;
  /** What to do when no handler matches the request (default: "warn"). */
  onUnhandledRequest?: OnUnhandledRequestStrategy;
};

// Discriminated union for core dispatch:
export type TryHandleResult =
  | { matched: true; res: Response }
  | { matched: false };

// Adapter management
export type CoreForAdapter = {
  tryHandle: (req: Request) => Promise<TryHandleResult>;
  getOptions: () => Required<ListenOptions>;
  logUnhandled: (kind: "warn" | "error", req: Request, url: URL) => void;
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
