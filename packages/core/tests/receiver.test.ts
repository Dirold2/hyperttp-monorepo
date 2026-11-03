import { afterEach, describe, expect, it, vi } from "vitest";
import { HyperCore, RestProtocol, RestReceiver } from "../src/index.js";
import { resetCachedProtocols, resolveReceiver } from "../src/protocols/manager.js";
import type {
  HyperTransport,
  ServerRequestContext,
  TransportListenOptions,
  TransportRequest,
  TransportResponse,
  TransportServer,
} from "@hyperttp/types";
import type { RestServerResponse } from "../src/protocols/rest/type.js";
import { RestSender } from "../src/index.js";
import { FetchTransport } from "../src/transports/fetch.js";

function makeRawRequest(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    method: "POST",
    url: "/users?page=2",
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify({ name: "neo" })),
    protocol: "rest",
    ...overrides,
  };
}

class MockServerTransport implements HyperTransport {
  public onRequest?: (req: TransportRequest) => Promise<TransportResponse> | TransportResponse;
  public closed = false;
  public closeSpy = vi.fn(async () => {});

  public async execute(req: TransportRequest): Promise<TransportResponse> {
    return {
      status: 200,
      headers: {},
      url: req.url,
      body: undefined,
    };
  }

  public async listen(options: TransportListenOptions): Promise<TransportServer> {
    this.onRequest = options.onRequest;
    return {
      close: async () => {
        this.closed = true;
      },
    };
  }

  public async close(): Promise<void> {
    this.closeSpy();
  }
}

afterEach(() => {
  resetCachedProtocols();
});

describe("receiver manager", () => {
  it("resolves the rest receiver", async () => {
    const receiver = await resolveReceiver("rest");
    expect(receiver).toBeInstanceOf(RestReceiver);
    expect(receiver.protocol).toBe("rest");
  });

  it("throws for a packaged protocol receiver that is not installed", async () => {
    await expect(resolveReceiver("grpc")).rejects.toThrow(
      /No protocol available for "grpc".*@hyperttp\/protocol-grpc/,
    );
  });
});

describe("HyperProtocol unified module", () => {
  it("registers a unified protocol and exposes both sides", () => {
    const core = new HyperCore({ protocols: [RestProtocol] }, new MockServerTransport());

    expect(core.getProtocol("rest")).toBe(RestProtocol);
    expect(core.getSender("rest")).toBe(RestProtocol.sender);
    expect(core.getReceiver("rest")).toBe(RestProtocol.receiver);
  });

  it("registerSender preserves an existing receiver and vice versa", () => {
    const receiver = new RestReceiver();
    const core = new HyperCore({}, new MockServerTransport());
    core.registerReceiver(receiver);
    core.registerSender(new RestSender());

    expect(core.getReceiver("rest")).toBe(receiver);
    expect(core.getSender("rest")).toBeInstanceOf(RestSender);

    const other = new RestReceiver({ handler: () => ({ status: 200, body: "ok" }) });
    core.registerReceiver(other);
    expect(core.getReceiver("rest")).toBe(other);
    expect(core.getSender("rest")).toBeInstanceOf(RestSender);
  });

  it("serves requests through a unified protocol module", async () => {
    const transport = new MockServerTransport();
    const core = new HyperCore({ protocols: [RestProtocol] }, transport);

    await core.listen({
      protocol: "rest",
      handler: () => ({ status: 200, body: "ok" }),
    });

    const res = await transport.onRequest!(makeRawRequest());
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(res.body as Uint8Array)).toBe("ok");
  });
});

describe("HyperCore.listen (server role)", () => {
  it("starts a server through the transport listen capability", async () => {
    const transport = new MockServerTransport();
    const core = new HyperCore({}, transport);

    const server = await core.listen({ protocol: "rest", port: 3000 });
    expect(server).toBeDefined();
    expect(transport.onRequest).toBeDefined();
  });

  it("runs the receive → handle → respond pipeline with the listen handler", async () => {
    const transport = new MockServerTransport();
    const core = new HyperCore({}, transport);
    const handleSpy = vi.fn(
      (request: { path: string; query: Record<string, string>; body: unknown }) =>
        ({
          status: 201,
          headers: { "x-handled": "yes" },
          body: { echo: request.body, path: request.path, page: request.query.page },
        }) as RestServerResponse,
    );

    await core.listen({
      protocol: "rest",
      handler: handleSpy as (request: unknown, ctx: ServerRequestContext) => RestServerResponse,
    });

    const res = await transport.onRequest!(makeRawRequest());
    expect(handleSpy).toHaveBeenCalledOnce();

    const call = handleSpy.mock.calls[0]![0] as {
      method: string;
      path: string;
      query: Record<string, string>;
      body: unknown;
    };
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/users");
    expect(call.query).toEqual({ page: "2" });
    expect(call.body).toEqual({ name: "neo" });

    expect(res.status).toBe(201);
    expect(res.headers["x-handled"]).toBe("yes");
    expect(res.body).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(new TextDecoder().decode(res.body as Uint8Array))).toEqual({
      echo: { name: "neo" },
      path: "/users",
      page: "2",
    });
  });

  it("falls back to receiver.handle when no listen handler is provided", async () => {
    const transport = new MockServerTransport();
    const core = new HyperCore({}, transport);
    const receiverHandler = vi.fn(
      (request: { path: string }) =>
        ({ status: 200, body: { via: "receiver", path: request.path } }) as RestServerResponse,
    );

    core.registerReceiver(new RestReceiver({ handler: receiverHandler }));

    await core.listen({ protocol: "rest" });
    const res = await transport.onRequest!(makeRawRequest());

    expect(receiverHandler).toHaveBeenCalledOnce();
    expect(JSON.parse(new TextDecoder().decode(res.body as Uint8Array))).toEqual({
      via: "receiver",
      path: "/users",
    });
  });

  it("lazily resolves and registers the rest receiver when not registered", async () => {
    const transport = new MockServerTransport();
    const core = new HyperCore({}, transport);

    await core.listen({ protocol: "rest", handler: () => ({ status: 200, body: "ok" }) });
    expect(core.getReceiver("rest")).toBeInstanceOf(RestReceiver);

    const res = await transport.onRequest!(makeRawRequest());
    expect(res.status).toBe(200);
  });

  it("uses FetchTransport for listen() when the client transport has no server role", async () => {
    const execute = vi.fn(async (req: TransportRequest) => ({
      status: 200,
      headers: {},
      url: req.url,
      body: undefined,
    }));
    const clientOnly = { execute, close: async () => {} };
    const serverHandle = { close: vi.fn(async () => {}) };
    const listen = vi.spyOn(FetchTransport.prototype, "listen").mockResolvedValue(serverHandle);
    const core = new HyperCore({}, clientOnly as HyperTransport);

    await expect(core.listen({ protocol: "rest" })).resolves.toEqual({
      close: expect.any(Function),
    });
    expect(listen).toHaveBeenCalledOnce();

    await core.send({ protocol: "rest", input: { method: "GET", url: "/client" } });
    expect(execute).toHaveBeenCalledOnce();

    await core.destroy();
    expect(serverHandle.close).toHaveBeenCalledOnce();
  });

  it("destroy closes active servers and the transport", async () => {
    const transport = new MockServerTransport();
    const core = new HyperCore({}, transport);

    await core.listen({ protocol: "rest", handler: () => ({ status: 200, body: "ok" }) });
    await core.destroy();

    expect(transport.closed).toBe(true);
    expect(transport.closeSpy).toHaveBeenCalled();
  });
});
