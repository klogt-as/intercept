import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { HttpResponse } from "../http/response";
import { intercept } from "./intercept";

/**
 * Stub the "original" fetch BEFORE calling intercept.listen(),
 * so the server/adapter captures it for passthrough in warn/bypass modes.
 */
function stubOriginalFetchReturning(text: string, init?: ResponseInit) {
  const original = vi.fn(async () => new Response(text, init));
  globalThis.fetch = original;
  return original;
}

async function expectJSON(res: Response, status: number, json: unknown) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual(json);
}

beforeEach(() => {
  // Use Vitest fake timers for deterministic delay tests.
  vi.useFakeTimers();
});

afterEach(() => {
  // Full cleanup after each test to keep them independent
  intercept.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("intercept integration (origin + absolute URLs)", () => {
  it("requires listen() before route registration (DX guard)", () => {
    // Do not call listen() here on purpose
    expect(() => {
      intercept.get("/todos").resolve([{ id: 1 }]);
    }).toThrow(/must call intercept\.listen/i);
  });

  it("resolve(): returns JSON with sensible default status per method", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");

    // GET defaults to 200
    intercept.get("/todos").resolve([{ id: 1 }]);
    await expectJSON(await fetch("https://api.test/todos"), 200, [{ id: 1 }]);

    // POST defaults to 201
    intercept.post("/todos").resolve({ id: 2 });
    await expectJSON(
      await fetch("https://api.test/todos", { method: "POST" }),
      201,
      { id: 2 },
    );
  });

  it("reject(): returns error status + custom body/headers", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");

    intercept.get("/users").reject({
      status: 404,
      body: { message: "Not found" },
      headers: { "x-test": "1" },
    });

    const res = await fetch("https://api.test/users");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-test")).toBe("1");
    expect(await res.json()).toEqual({ message: "Not found" });
  });

  it("handle(): receives params and JSON body and can respond dynamically", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");

    intercept.post("/users/:id").handle(async ({ params, body }) => {
      return HttpResponse.json(
        { id: params.id, ok: true, echo: body },
        { status: 201 },
      );
    });

    const res = await fetch("https://api.test/users/42", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    });

    await expectJSON(res, 201, { id: "42", ok: true, echo: { name: "Ada" } });
  });

  it("fetching({ delayMs }): resolves after a delay with 204 No Content", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");
    intercept.get("/slow").fetching({ delayMs: 200 });

    const p = fetch("https://api.test/slow");

    // Not settled yet:
    let settled = false;
    p.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const res = await p;
    expect(res.status).toBe(204);
    expect(await res.text()).toBe(""); // 204 must have no body
  });

  it("ignore(): silences provided paths with 204 across all HTTP methods", async () => {
    const original = stubOriginalFetchReturning("should-not-be-called", {
      status: 200,
    });
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");

    // Silence analytics & health-checks in tests
    intercept.ignore(["/analytics", "/ping"]);

    // GET
    const resGet = await fetch("https://api.test/analytics");
    expect(resGet.status).toBe(204);
    expect(await resGet.text()).toBe("");

    // POST
    const resPost = await fetch("https://api.test/analytics", {
      method: "POST",
    });
    expect(resPost.status).toBe(204);
    expect(await resPost.text()).toBe("");

    // OPTIONS
    const resOptions = await fetch("https://api.test/ping", {
      method: "OPTIONS",
    });
    expect(resOptions.status).toBe(204);
    expect(await resOptions.text()).toBe("");

    // Ensure passthrough never happened
    expect(original).not.toHaveBeenCalled();
  });

  it("ignore(): later, more specific handlers can override an ignored path (last wins)", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");

    // First, ignore the path…
    intercept.ignore(["/thing"]);

    // …then override with a specific handler registered later
    intercept.get("/thing").resolve({ v: "override" });

    const res = await fetch("https://api.test/thing");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ v: "override" });
  });

  it("Last handler wins: the most recently registered handler has priority", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");

    intercept.get("/thing").resolve({ v: "A" });
    intercept.get("/thing").resolve({ v: "B" }); // should win

    await expectJSON(await fetch("https://api.test/thing"), 200, { v: "B" });
  });

  it('onUnhandledRequest: "warn" logs and passthrough calls original fetch', async () => {
    // NOTE: 204 cannot have a body. Use 200 here since we assert on text.
    const original = stubOriginalFetchReturning("ok", { status: 200 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    intercept.listen({ onUnhandledRequest: "warn" });

    const res = await fetch("https://api.test/unhandled");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it('onUnhandledRequest: "bypass" does not log and passthrough', async () => {
    const original = stubOriginalFetchReturning("bypassed", { status: 202 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    intercept.listen({ onUnhandledRequest: "bypass" });

    const res = await fetch("https://api.test/not-registered");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("bypassed");
  });

  it('onUnhandledRequest: "warn" logs and passes through', async () => {
    const original = stubOriginalFetchReturning(JSON.stringify({ ok: true }), {
      status: 200,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    intercept.listen({ onUnhandledRequest: "warn" });

    const res = await fetch("https://api.test/not-found-here");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);

    warnSpy.mockRestore();
  });

  it('onUnhandledRequest: "error" returns a 501 Response (no passthrough, no original fetch)', async () => {
    const original = stubOriginalFetchReturning("should-not-be-used", {
      status: 200,
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    intercept.listen({ onUnhandledRequest: "error" });

    const res = await fetch("https://api.test/not-found-here");

    // fetch resolves; HTTP error signaled via status code + body
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "Unhandled request",
      details: {
        method: "GET",
        // URL in details is full; loosen match to avoid brittleness
        url: expect.stringContaining("https://api.test/not-found-here"),
      },
    });

    // No passthrough in "error" mode
    expect(original).not.toHaveBeenCalled();

    // We log an error, but do not throw here
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("listen() can update onUnhandledRequest on-the-fly (last call wins)", async () => {
    const original = stubOriginalFetchReturning("OK", { status: 200 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    intercept.listen({ onUnhandledRequest: "error" });
    // Switch to "warn" while server is running:
    intercept.listen({ onUnhandledRequest: "warn" });

    const res = await fetch("https://api.test/missing");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("absolute URL handlers have highest priority over relative", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");

    intercept.get("/v1/charges").resolve({ via: "relative" });
    intercept.get("https://api.test/v1/charges").resolve({ via: "absolute" });

    const res = await fetch("https://api.test/v1/charges");
    await expect(res.json()).resolves.toEqual({ via: "absolute" });
  });

  it("matches absolute URL with query exactly (non-throwing miss)", async () => {
    const original = stubOriginalFetchReturning("bypassed", { status: 202 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); // silence log

    intercept.listen({ onUnhandledRequest: "warn" });

    intercept
      .get("https://api.test/v1/charges?status=open")
      .resolve({ ok: true });

    const hit = await fetch("https://api.test/v1/charges?status=open");
    await expect(hit.json()).resolves.toEqual({ ok: true });

    const miss = await fetch("https://api.test/v1/charges?status=closed");
    expect(original).toHaveBeenCalledTimes(1);
    expect(miss.status).toBe(202);
    expect(await miss.text()).toBe("bypassed");

    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it("chainable origin: origin(...).get(...).resolve(...) works", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept.listen({ onUnhandledRequest: "error" });

    intercept
      .origin("https://api.test")
      .get("/v1/charges")
      .resolve({ chained: true });

    const res = await fetch("https://api.test/v1/charges");
    await expect(res.json()).resolves.toEqual({ chained: true });
  });

  it("chainable listen().origin(...): can set both in one go", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://api.test");

    intercept.get("/hello").resolve({ hi: true });

    const res = await fetch("https://api.test/hello");
    await expect(res.json()).resolves.toEqual({ hi: true });
  });
});

/**
 * Nested suite to prove origin set in beforeAll applies to whole file
 * until explicitly overridden. We control lifecycle here (no afterEach close).
 */
describe("origin lifecycle via beforeAll (persists and can be overridden)", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    stubOriginalFetchReturning("should-not-be-called");
    intercept
      .listen({ onUnhandledRequest: "error" })
      .origin("https://file.test");
  });

  afterEach(() => {
    intercept.reset();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterAll(() => {
    intercept.close();
  });

  it("uses origin from beforeAll across tests", async () => {
    intercept.get("/ping").resolve({ ok: true });
    await expectJSON(await fetch("https://file.test/ping"), 200, { ok: true });
  });

  it("still uses same origin if not overridden", async () => {
    intercept.get("/pong").resolve({ ok: true });
    await expectJSON(await fetch("https://file.test/pong"), 200, { ok: true });
  });

  it("origin can be overridden and takes effect immediately", async () => {
    intercept.origin("https://override.test");
    intercept.get("/v2").resolve({ site: "override" });

    const res = await fetch("https://override.test/v2");
    await expect(res.json()).resolves.toEqual({ site: "override" });
  });
});
