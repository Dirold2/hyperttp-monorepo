import { afterEach, describe, expect, it, vi } from "vitest";

import { BunTransport } from "../src/index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
});

describe("BunTransport.listen", () => {
  function mockServer() {
    const stop = vi.fn().mockResolvedValue(undefined);
    const serve = vi.fn().mockReturnValue({ stop });
    vi.stubGlobal("Bun", { serve });
    return { serve, stop };
  }

  it("passes raw requests and preserves response streams and repeated headers", async () => {
    const { serve, stop } = mockServer();
    const body = new Response("response").body;
    const onRequest = vi.fn().mockResolvedValue({
      status: 201,
      statusText: "Created",
      headers: { "set-cookie": ["a=1; Path=/", "b=2; Path=/"] },
      body,
    });
    const transport = new BunTransport({});
    const server = await transport.listen({ host: "127.0.0.1", port: 8080, onRequest });
    const options = serve.mock.calls[0]![0];
    expect(options).toMatchObject({ hostname: "127.0.0.1", port: 8080 });

    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "request",
    });
    const response = await options.fetch(request);
    expect(onRequest).toHaveBeenCalledWith({
      method: "POST",
      url: request.url,
      headers: { "content-type": "text/plain" },
      body: request.body,
      signal: request.signal,
      protocol: "rest",
    });
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.body).toBe(body);
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(await response.text()).toBe("response");
    await server.close();
    expect(stop).toHaveBeenCalledWith(false);
    await transport.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("rejects incoming requests when onRequest is omitted", async () => {
    const { serve } = mockServer();
    const transport = new BunTransport({});
    await transport.listen({ port: 8080 });
    const response = await serve.mock.calls[0]![0].fetch(new Request("http://localhost/"));
    expect(response.status).toBe(503);
    await transport.close();
  });

  it("does not start a server for an already aborted signal", async () => {
    const { serve } = mockServer();
    const transport = new BunTransport({});
    await expect(transport.listen({ signal: AbortSignal.abort() })).rejects.toThrow();
    expect(serve).not.toHaveBeenCalled();
    await transport.close();
  });

  it("stops the server when the signal is aborted", async () => {
    const { stop } = mockServer();
    const controller = new AbortController();
    const transport = new BunTransport({});
    await transport.listen({ signal: controller.signal });
    controller.abort();
    expect(stop).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect((transport as any).servers.size).toBe(0));
    await transport.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("gracefully closes all servers and removes abort listeners", async () => {
    const { stop } = mockServer();
    const controller = new AbortController();
    const transport = new BunTransport({});
    await transport.listen({ port: 8080, signal: controller.signal });
    await transport.listen({ port: 8081 });
    await transport.close();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledWith(false);
    controller.abort();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("forcefully stops servers on destroy", async () => {
    const { stop } = mockServer();
    const transport = new BunTransport({});
    await transport.listen({});
    await transport.destroy();
    expect(stop).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("propagates server startup errors", async () => {
    const { serve } = mockServer();
    serve.mockImplementation(() => {
      throw new Error("Address in use");
    });
    const transport = new BunTransport({});
    await expect(transport.listen({ port: 8080 })).rejects.toThrow("Address in use");
    await transport.close();
  });
});

describe("BunTransport", () => {
  it("supports REST and returns the raw response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = new BunTransport({ baseUrl: "https://api.example.com" });
    const response = await transport.execute({
      url: "/health",
      method: "GET",
      headers: {},
      protocol: "rest",
    });

    expect(transport.protocols).toEqual(["rest"]);
    expect(transport.supports("rest")).toBe(true);
    expect(transport.supports("graphql")).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty("headers");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain");
    expect(await new Response(response.body as BodyInit).text()).toBe("ok");
  });

  it("bypasses the response cache for stream requests", async () => {
    const firstResponse = new Response("first");
    const secondResponse = new Response("second");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = new BunTransport({
      baseUrl: "https://api.example.com",
      network: { cache: { maxSize: 1 } },
    });
    const request = {
      url: "/audio.mp3",
      method: "GET",
      headers: {},
      protocol: "rest" as const,
      stream: true,
    };

    const first = await transport.execute(request);
    const second = await transport.execute(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.body).toBe(firstResponse.body);
    expect(second.body).toBe(secondResponse.body);
  });

  it("does not cache native response bodies for ordinary requests", async () => {
    const firstResponse = new Response("first");
    const secondResponse = new Response("second");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = new BunTransport({
      baseUrl: "https://api.example.com",
      network: { cache: { maxSize: 1 } },
    });
    const request = {
      url: "/response-with-body",
      method: "GET",
      headers: {},
      protocol: "rest" as const,
    };

    const first = await transport.execute(request);
    const second = await transport.execute(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.body).toBe(firstResponse.body);
    expect(second.body).toBe(secondResponse.body);
  });

  it("skips cookie lookups until a response sets a cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = new BunTransport({ baseUrl: "https://api.example.com" });
    const getCookiesForDomain = vi.spyOn(transport as any, "getCookiesForDomain");

    await transport.execute({
      url: "/health",
      method: "GET",
      headers: {},
      protocol: "rest",
    });

    expect(getCookiesForDomain).not.toHaveBeenCalled();
  });

  it("uses cookies after receiving Set-Cookie", async () => {
    const headers = {
      getSetCookie: () => ["session=abc; Path=/"],
      forEach: (callback: (value: string, key: string) => void) => {
        callback("session=abc; Path=/", "set-cookie");
      },
    } as unknown as Headers;
    const response = {
      status: 200,
      url: "https://api.example.com/login",
      body: null,
      headers,
    } as Response;
    const fetchMock = vi.fn().mockResolvedValue(response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = new BunTransport({ baseUrl: "https://api.example.com" });
    await transport.execute({ url: "/login", method: "POST", headers: {}, protocol: "rest" });
    await transport.execute({ url: "/profile", method: "GET", headers: {}, protocol: "rest" });

    expect(fetchMock.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ headers: expect.objectContaining({ cookie: "session=abc" }) }),
    );
  });

  it("skips cookie parsing and lookup when the cookie cache is disabled", async () => {
    const getSetCookie = vi.fn(() => ["session=abc; Path=/"]);
    const headers = {
      getSetCookie,
      forEach: (callback: (value: string, key: string) => void) => {
        callback("session=abc; Path=/", "set-cookie");
      },
    } as unknown as Headers;
    const response = {
      status: 200,
      url: "https://api.example.com/login",
      body: null,
      headers,
    } as Response;
    const fetchMock = vi.fn().mockResolvedValue(response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = new BunTransport({
      baseUrl: "https://api.example.com",
      network: { cookieCache: { enabled: false } },
    });
    const getCookiesForDomain = vi.spyOn(transport as any, "getCookiesForDomain");

    await transport.execute({ url: "/login", method: "POST", headers: {}, protocol: "rest" });
    await transport.execute({ url: "/profile", method: "GET", headers: {}, protocol: "rest" });

    expect(getSetCookie).not.toHaveBeenCalled();
    expect(getCookiesForDomain).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[1]![1]).not.toHaveProperty("headers");
  });
});
