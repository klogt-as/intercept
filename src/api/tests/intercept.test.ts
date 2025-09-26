import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../core/server";
import { HttpResponse } from "../../http/response";
import { intercept } from "../intercept";

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
      { id: 2 }
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
        { status: 201 }
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

  it('onUnhandledRequest: "error" logs and returns 501 without passthrough', async () => {
    const original = stubOriginalFetchReturning("should-not-be-used", {
      status: 200,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });

    const res = await fetch("http://api.test/not-found-here");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();
    expect(res.status).toBe(501);

    const body = await res.json();
    expect(body?.error).toBe("Unhandled request");
    expect(body?.details?.url).toBe("http://api.test/not-found-here");
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
