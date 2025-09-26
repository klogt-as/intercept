// -------------------------
// HttpResponse helper (MSW-like)
// -------------------------

/**
 * `HttpResponse` mirrors MSW’s ergonomics for returning mocked responses.
 */
export class HttpResponse extends Response {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body ?? null, init);
  }

  /**
   * Create a JSON response with a proper `content-type` header.
   */
  static json(data: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers as HeadersInit);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new Response(JSON.stringify(data), { ...init, headers });
  }
}
