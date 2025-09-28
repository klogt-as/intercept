import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../core/server";
import { HttpResponse } from "../http/response";
import { intercept } from "./intercept";

/**
 * Stub the "original" fetch BEFORE calling server.listen(),
 * so the server captures it for passthrough in warn/bypass modes.
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
  // Clean up after each test
  server.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("server and intercept integration", () => {
  it("resolve(): returns JSON with sensible default status per method", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });

    // GET defaults to 200
    intercept.get("/todos").resolve([{ id: 1 }]);
    await expectJSON(await fetch("http://api.test/todos"), 200, [{ id: 1 }]);

    // POST defaults to 201
    intercept.post("/todos").resolve({ id: 2 });
    await expectJSON(
      await fetch("http://api.test/todos", { method: "POST" }),
      201,
      { id: 2 },
    );
  });

  it("reject(): returns error status + custom body/headers", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({
      baseUrl: "http://api.test/base/api",
      onUnhandledRequest: "error",
    });

    intercept.get("/users").reject({
      status: 404,
      body: { message: "Not found" },
      headers: { "x-test": "1" },
    });

    const res = await fetch("http://api.test/base/api/users");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-test")).toBe("1");
    expect(await res.json()).toEqual({ message: "Not found" });
  });

  it("handle(): receives params and JSON body and can respond dynamically", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({
      baseUrl: "http://api.test/org/app/api",
      onUnhandledRequest: "error",
    });

    intercept.post("/users/:id").handle(async ({ params, body }) => {
      return HttpResponse.json(
        { id: params.id, ok: true, echo: body },
        { status: 201 },
      );
    });

    const res = await fetch("http://api.test/org/app/api/users/42", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    });

    await expectJSON(res, 201, { id: "42", ok: true, echo: { name: "Ada" } });
  });

  it("fetching({ delayMs }): resolves after a delay with 204 No Content", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });

    intercept.get("/slow").fetching({ delayMs: 200 });

    const p = fetch("http://api.test/slow");

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
    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });

    // Silence analytics & health-checks in tests
    intercept.ignore(["/analytics", "/ping"]);

    // GET
    const resGet = await fetch("http://api.test/analytics");
    expect(resGet.status).toBe(204);
    expect(await resGet.text()).toBe("");

    // POST
    const resPost = await fetch("http://api.test/analytics", {
      method: "POST",
    });
    expect(resPost.status).toBe(204);
    expect(await resPost.text()).toBe("");

    // OPTIONS
    const resOptions = await fetch("http://api.test/ping", {
      method: "OPTIONS",
    });
    expect(resOptions.status).toBe(204);
    expect(await resOptions.text()).toBe("");

    // Ensure passthrough never happened
    expect(original).not.toHaveBeenCalled();
  });

  it("ignore(): later, more specific handlers can override an ignored path (last wins)", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });

    // First, ignore the path…
    intercept.ignore(["/thing"]);

    // …then override with a specific handler registered later
    intercept.get("/thing").resolve({ v: "override" });

    const res = await fetch("http://api.test/thing");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ v: "override" });
  });

  it("Last handler wins: the most recently registered handler has priority", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });

    intercept.get("/thing").resolve({ v: "A" });
    intercept.get("/thing").resolve({ v: "B" }); // should win

    await expectJSON(await fetch("http://api.test/thing"), 200, { v: "B" });
  });

  it('onUnhandledRequest: "warn" logs and passthrough calls original fetch', async () => {
    // NOTE: 204 cannot have a body. Use 200 here since we assert on text.
    const original = stubOriginalFetchReturning("ok", { status: 200 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "warn" });

    const res = await fetch("http://api.test/unhandled");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it('onUnhandledRequest: "bypass" does not log and passthrough', async () => {
    const original = stubOriginalFetchReturning("bypassed", { status: 202 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "bypass" });

    const res = await fetch("http://api.test/not-registered");
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

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "warn" });

    const res = await fetch("http://api.test/not-found-here");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);

    warnSpy.mockRestore();
  });

  it('onUnhandledRequest: "error" throws (no passthrough, no 501)', async () => {
    const original = stubOriginalFetchReturning("should-not-be-used", {
      status: 200,
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });

    await expect(fetch("http://api.test/not-found-here")).rejects.toThrow(
      /Unhandled request \(error mode\)/,
    );

    expect(original).not.toHaveBeenCalled();

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("listen() can update onUnhandledRequest on-the-fly", async () => {
    const original = stubOriginalFetchReturning("OK", { status: 200 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });
    // Switch to "warn" while server is running:
    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "warn" });

    const res = await fetch("http://api.test/missing");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("matches routes relative to a baseUrl with a path prefix", async () => {
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({
      baseUrl: "http://api.test/prefix/api",
      onUnhandledRequest: "error",
    });

    intercept.get("/users/:id").handle(({ params }) => {
      return HttpResponse.json({ id: params.id, ok: true }, { status: 200 });
    });

    await expectJSON(await fetch("http://api.test/prefix/api/users/123"), 200, {
      id: "123",
      ok: true,
    });
  });
});
