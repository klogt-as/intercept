import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { intercept } from "../api/intercept";
import { server } from "../core/server";
import { createAxiosAdapter } from "./axios";
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

  const axios: MinimalAxiosInstance = {
    defaults: {
      adapter: originalAdapter,
      baseURL: "http://api.test",
    },
    request: async (config) => {
      const adapter = axios.defaults.adapter;
      if (!adapter) throw new Error("No adapter configured");
      return adapter(config);
    },
  };

  return { axios, originalAdapter, calls };
}

/** -----------------------------
 * Testhjelpere
 * ------------------------------*/
function stubOriginalFetchReturning(text: string, init?: ResponseInit) {
  // Serveren auto-attacher fetch-adapter i listen(); sørg for forutsigbar passthrough
  const original = vi.fn(async () => new Response(text, init));
  globalThis.fetch = original;
  return original;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  server.close();
  vi.restoreAllMocks();
});

describe("axios adapter + intercept", () => {
  it("resolve(): default status per metode og mapping til AxiosResponse", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });
    server.attachAdapter(createAxiosAdapter(axios));

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
    server.listen({
      baseUrl: "http://api.test/base/api",
      onUnhandledRequest: "error",
    });
    axios.defaults.baseURL = server.getBaseUrl();
    server.attachAdapter(createAxiosAdapter(axios));

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

  it("handle(): params + JSON-body fungerer (201)", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({
      baseUrl: "http://api.test/org/app/api",
      onUnhandledRequest: "error",
    });
    axios.defaults.baseURL = server.getBaseUrl();
    server.attachAdapter(createAxiosAdapter(axios));

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

  it('unhandled "warn": logger og kaller original adapter', async () => {
    const { axios, calls } = createAxiosStub();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 204-body er tom, så bruk 200 i passthrough for å kunne lese tekst
    stubOriginalFetchReturning("OK", { status: 200 });

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "warn" });
    server.attachAdapter(createAxiosAdapter(axios));

    const res = await axios.request({ url: "/no-handler", method: "get" });
    expect(res.status).toBe(299); // fra original axios-adapter
    expect(calls.configs).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('unhandled "bypass": ingen logging, kaller original adapter', async () => {
    const { axios, calls } = createAxiosStub();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubOriginalFetchReturning("OK", { status: 200 });

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "bypass" });
    server.attachAdapter(createAxiosAdapter(axios));

    const res = await axios.request({ url: "/no-handler", method: "get" });
    expect(res.status).toBe(299);
    expect(calls.configs).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('unhandled "error": kaster axios-lignende feil med 501 og detaljer', async () => {
    const { axios } = createAxiosStub();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubOriginalFetchReturning("SHOULD-NOT", { status: 200 });

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });
    server.attachAdapter(createAxiosAdapter(axios));

    await expect(
      axios.request({ url: "/blocked", method: "post", data: { x: 1 } }),
    ).rejects.toMatchObject({
      isAxiosError: true,
      response: {
        status: 501,
        data: expect.objectContaining({
          error: "Unhandled request",
          details: expect.objectContaining({
            method: "POST",
            url: "http://api.test/blocked",
          }),
        }),
      },
    });

    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("JSON-serialisering når data ikke er BodyInit + automatisk content-type", async () => {
    const { axios } = createAxiosStub();
    stubOriginalFetchReturning("should-not-be-called");
    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "error" });
    server.attachAdapter(createAxiosAdapter(axios));

    // Echo-endepunkt via intercept for å verifisere faktisk body og header
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

  it("matcher ruter relativt til baseUrl med path-prefiks", async () => {
    const { axios } = createAxiosStub();
    axios.defaults.baseURL = "http://api.test/prefix/api";
    stubOriginalFetchReturning("should-not-be-called");

    server.listen({
      baseUrl: "http://api.test/prefix/api",
      onUnhandledRequest: "error",
    });
    server.attachAdapter(createAxiosAdapter(axios));

    intercept.get("/users/:id").handle(({ params }) => {
      return new Response(JSON.stringify({ id: params.id, ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await axios.request({ url: "/users/123", method: "get" });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: "123", ok: true });
  });

  it("detachAdapter() reverterer til original adapter", async () => {
    const { axios, originalAdapter } = createAxiosStub();
    stubOriginalFetchReturning("OK", { status: 200 });

    server.listen({ baseUrl: "http://api.test", onUnhandledRequest: "warn" });
    const ax = createAxiosAdapter(axios);
    server.attachAdapter(ax);

    expect(axios.defaults.adapter).not.toBe(originalAdapter);

    server.detachAdapter(ax);
    expect(axios.defaults.adapter).toBe(originalAdapter);

    const res = await axios.request({ url: "/still-works", method: "get" });
    expect(res.status).toBe(299); // original adapter svar
  });
});
