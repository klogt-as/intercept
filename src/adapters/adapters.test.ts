import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { intercept } from "../api/intercept";
import type {
  AxiosAdapterFn,
  MinimalAxiosConfig,
  MinimalAxiosInstance,
} from "./types";

function createAxiosStub() {
  const calls: { configs: MinimalAxiosConfig[] } = { configs: [] };
  const originalAdapter: AxiosAdapterFn = async (config) => {
    calls.configs.push(config);
    return {
      data: { from: "original-adapter", echo: config.data ?? null },
      status: 299,
      statusText: "OK",
      headers: { "x-orig": "1" },
      config,
      request: null,
    };
  };

  const interceptors: Array<{
    onFulfilled: (config: MinimalAxiosConfig) => MinimalAxiosConfig;
    onRejected: (error: unknown) => unknown;
  }> = [];

  const axios: MinimalAxiosInstance & {
    interceptors: {
      request: {
        use: (
          onFulfilled: (config: MinimalAxiosConfig) => MinimalAxiosConfig,
          onRejected: (error: unknown) => unknown,
        ) => number;
        eject: (id: number) => void;
      };
    };
  } = {
    defaults: {
      adapter: originalAdapter,
      baseURL: "http://api.test", // default base for tests that rely on axios baseURL
    },
    request: async (config) => {
      const adapter = axios.defaults.adapter;
      if (!adapter) throw new Error("No adapter configured");
      return adapter(config);
    },
    interceptors: {
      request: {
        use: (onFulfilled, onRejected) => {
          interceptors.push({ onFulfilled, onRejected });
          return interceptors.length - 1;
        },
        eject: (id) => {
          delete interceptors[id];
        },
      },
    },
  };

  return { axios, originalAdapter, calls };
}

/** -----------------------------
 * Test helpers
 * ------------------------------*/
function stubOriginalFetchReturning(text: string, init?: ResponseInit) {
  // Server auto-attaches the fetch-adapter on listen(); ensure predictable passthrough
  const original = vi.fn(async () => new Response(text, init));
  globalThis.fetch = original;
  return original;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  intercept.reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterAll(() => {
  intercept.close();
});

describe("axios adapter + intercept", () => {
  it("resolve(): default status per method and mapping to AxiosResponse", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    // GET -> 200
    intercept.get("/todos").resolve([{ id: 1 }]);
    const getRes = await axios.request({ url: "/todos", method: "get" });
    expect(getRes.status).toBe(200);
    expect(getRes.data).toEqual([{ id: 1 }]);
    expect(getRes.headers["content-type"]).toMatch(/application\/json/);

    // POST -> 201
    intercept.post("/todos").resolve({ id: 2 });
    const postRes = await axios.request({
      url: "/todos",
      method: "post",
      data: { name: "Ada" },
    });
    expect(postRes.status).toBe(201);
    expect(postRes.data).toEqual({ id: 2 });
  });

  it("reject(): 404 + custom body/headers via intercept", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    intercept.get("/users").reject({
      status: 404,
      body: { message: "Not found" },
      headers: { "x-test": "1" },
    });

    const res = await axios.request({ url: "/users", method: "get" });
    expect(res.status).toBe(404);
    expect(res.headers["x-test"]).toBe("1");
    expect(res.data).toEqual({ message: "Not found" });
  });

  it("handle(): params + JSON body works (201)", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    intercept.post("/users/:id").handle(async ({ params, body }) => {
      return new Response(
        JSON.stringify({ id: params.id, ok: true, echo: body }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });

    const res = await axios.request({
      url: "/users/42",
      method: "post",
      headers: { "content-type": "application/json" },
      data: { name: "Ada" },
    });

    expect(res.status).toBe(201);
    expect(res.data).toEqual({ id: "42", ok: true, echo: { name: "Ada" } });
  });

  it('unhandled "warn": logs and calls original adapter', async () => {
    const { axios, calls } = createAxiosStub();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 204 might yield empty body, use 200 in passthrough to read text if needed
    stubOriginalFetchReturning("OK", { status: 200 });

    intercept.listen({
      onUnhandledRequest: "warn",
      adapter: axios,
    });

    const res = await axios.request({ url: "/no-handler", method: "get" });
    expect(res.status).toBe(299); // from original axios adapter
    expect(calls.configs).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('unhandled "bypass": no logging, calls original adapter', async () => {
    const { axios, calls } = createAxiosStub();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubOriginalFetchReturning("OK", { status: 200 });

    intercept.listen({
      onUnhandledRequest: "bypass",
      adapter: axios,
    });

    const res = await axios.request({ url: "/no-handler", method: "get" });
    expect(res.status).toBe(299);
    expect(calls.configs).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('unhandled "error": rejects with axios-like 501 error (no passthrough)', async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("SHOULD-NOT", { status: 200 });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    intercept.listen({
      onUnhandledRequest: "error",
      adapter: axios,
    });

    await expect(
      axios.request({ url: "/blocked", method: "post", data: { x: 1 } }),
    ).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 501 },
    });

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("JSON serialization when data is not BodyInit + automatic content-type", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    // Echo endpoint via intercept to verify actual body and header
    intercept.post("/echo").handle(async ({ body, request }) => {
      return new Response(
        JSON.stringify({
          ctype: request.headers.get("content-type"),
          body,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const res = await axios.request({
      url: "/echo",
      method: "post",
      data: { a: 1 },
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ctype: "application/json", body: { a: 1 } });
  });

  it("matches routes when axios baseURL has a path prefix (full pathname match)", async () => {
    const { axios } = createAxiosStub();
    axios.defaults.baseURL = "http://api.test/prefix/api";
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    // Viktig: siden core matcher hele pathname under origin, må pattern inkludere prefixet
    intercept.get("/prefix/api/users/:id").handle(({ params }) => {
      return new Response(JSON.stringify({ id: params.id, ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await axios.request({ url: "/users/123", method: "get" });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: "123", ok: true });
  });

  /** -----------------------------
   * Additional tests to improve branch coverage
   * ------------------------------*/

  function createAxiosStubWithoutOriginal() {
    const axios: MinimalAxiosInstance = {
      defaults: {
        // No adapter here on purpose
        baseURL: "http://api.test",
      },
      request: async (config) => {
        const adapter = axios.defaults.adapter;
        if (!adapter) throw new Error("No adapter configured");
        return adapter(config);
      },
    };
    return { axios };
  }

  it('unhandled "warn" without original adapter -> throws axios-like error (500)', async () => {
    const { axios } = createAxiosStubWithoutOriginal();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubOriginalFetchReturning("OK", { status: 200 });

    intercept.listen({
      onUnhandledRequest: "warn",
      adapter: axios,
    });

    await expect(
      axios.request({ url: "/no-handler", method: "get" }),
    ).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 500, data: expect.anything() },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('unhandled "bypass" without original adapter -> throws axios-like error (500)', async () => {
    const { axios } = createAxiosStubWithoutOriginal();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubOriginalFetchReturning("OK", { status: 200 });

    intercept.listen({
      onUnhandledRequest: "bypass",
      adapter: axios,
    });

    await expect(
      axios.request({ url: "/no-handler", method: "get" }),
    ).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 500, data: expect.anything() },
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("permissive headers: arrays, numbers, booleans, Date, objects are normalized", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    intercept.post("/headers-echo").handle(async ({ request }) => {
      const entries = Object.fromEntries(request.headers.entries());
      return new Response(JSON.stringify(entries), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const testDate = new Date("2020-01-01T00:00:00Z");

    const res = await axios.request({
      url: "/headers-echo",
      method: "post",
      headers: {
        "x-arr": ["a", "b"],
        "x-num": 42 as unknown as string,
        "x-bool": false as unknown as string,
        "x-date": testDate as unknown as string,
        "x-obj": { a: 1 } as unknown as string,
      } as unknown as Record<string, string>,
      data: { ok: true },
    });

    expect(res.status).toBe(200);

    const data = res.data as Record<string, string>;

    // WHATWG Headers join duplicate keys with ", "
    expect(data["x-arr"]).toBe("a, b");
    expect(data["x-num"]).toBe("42");
    expect(data["x-bool"]).toBe("false");
    expect(data["x-date"]).toBe(testDate.toUTCString());
    expect(data["x-obj"]).toBe(JSON.stringify({ a: 1 }));
  });

  it("responseToAxios parses vendor JSON, text/* and binary correctly", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    // vendor JSON
    intercept.get("/vjson").handle(async () => {
      return new Response(JSON.stringify({ kind: "hal" }), {
        status: 200,
        headers: { "content-type": "application/hal+json; charset=utf-8" },
      });
    });

    // text/*
    intercept.get("/vtext").handle(async () => {
      return new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    });

    // binary (no json/text)
    intercept.get("/vbin").handle(async () => {
      const buf = new Uint8Array([1, 2, 3]);
      return new Response(buf, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    });

    const j = await axios.request({ url: "/vjson", method: "get" });
    expect(j.data).toEqual({ kind: "hal" });

    const t = await axios.request({ url: "/vtext", method: "get" });
    expect(t.data).toBe("hello");

    const b = await axios.request({ url: "/vbin", method: "get" });
    expect(b.data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(b.data as ArrayBuffer))).toEqual([
      1, 2, 3,
    ]);
  });

  it("GET/HEAD should not send a body nor auto-set content-type", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    intercept.get("/no-body").handle(async ({ request }) => {
      const ctype = request.headers.get("content-type");
      const text = await request.text(); // if body was sent, this would read it
      return new Response(JSON.stringify({ ctype, len: text.length }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await axios.request({
      url: "/no-body",
      method: "get",
      // data provided, but MUST be ignored for GET
      data: { willBeIgnored: true },
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ctype: null, len: 0 });
  });

  it("BodyInit detection: URLSearchParams should be sent as raw body", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    intercept.post("/form").handle(async ({ request }) => {
      const text = await request.text();
      return new Response(JSON.stringify({ text }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const params = new URLSearchParams([
      ["a", "1"],
      ["b", "x y"],
    ]);
    const res = await axios.request({
      url: "/form",
      method: "post",
      data: params, // BodyInit path
    });

    expect(res.status).toBe(200);

    const data = res.data as Record<string, string>;

    expect(data.text).toBe("a=1&b=x+y");
  });

  it("baseURL precedence: config.baseURL > instance.defaults.baseURL; fallback is intercept.origin for relative URLs", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");

    intercept.listen({
      onUnhandledRequest: "error",
      origin: "http://api.test",
      adapter: axios,
    });

    intercept.get("/ping").resolve({ ok: true });

    // Case 1: instance default points elsewhere; config.baseURL correct → must win
    axios.defaults.baseURL = "http://api.test/wrong";
    const r1 = await axios.request({
      url: "/ping",
      method: "get",
      baseURL: "http://api.test",
    });
    expect(r1.status).toBe(200);
    expect(r1.data).toEqual({ ok: true });

    // Case 2: no config.baseURL; instance.defaults matches → should work
    axios.defaults.baseURL = "http://api.test";
    const r2 = await axios.request({ url: "/ping", method: "get" });
    expect(r2.status).toBe(200);
    expect(r2.data).toEqual({ ok: true });

    // Case 3: neither config nor instance; rely on intercept.origin for relative
    axios.defaults.baseURL = undefined;
    const r3 = await axios.request({ url: "/ping", method: "get" });
    expect(r3.status).toBe(200);
    expect(r3.data).toEqual({ ok: true });
  });
});
