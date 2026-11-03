import { describe, it, expect, expectTypeOf, vi } from "vitest";
import { HyperCore, HyperClientError, RestSender, TimeoutError } from "../src/index.js";
import type {
  HyperProtocol,
  HyperSender,
  HyperTransport,
  RequestContext,
  TransportServer,
  UniversalResponse,
} from "@hyperttp/types";

class CustomRestSender implements HyperSender<any, any, any, any> {
  readonly protocol = "rest";
  readonly methods = {
    get: (
      core: { send: (req: unknown) => Promise<unknown> },
      url: string,
      options?: Record<string, unknown>,
    ) => core.send({ protocol: "rest", input: { method: "GET", url, ...options } }),
  };
  prepare(request: any) {
    return request.input;
  }
  async send(prepared: any) {
    return prepared;
  }
  parse(raw: any) {
    return {
      protocol: "rest",
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {},
      url: raw.url,
      data: { via: "custom", url: raw.url },
      raw,
    };
  }
}

function makeMockTransport(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    async execute(req: { url: string; method: string }) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        url: req.url,
        body: new TextEncoder().encode(JSON.stringify({ ok: true, url: req.url })),
        ...overrides,
      };
    },
    close: vi.fn(async () => {}),
  };
}

function makeCore(transport: HyperTransport = makeMockTransport()) {
  const core = new HyperCore({}, transport);
  core.registerSender(new RestSender());
  return core;
}

describe("HyperCore (universal core)", () => {
  it("dispatches via core.send through the registered sender", async () => {
    const core = makeCore();
    const res = await core.send<{ method: string; url: string }, { ok: boolean }>({
      protocol: "rest",
      input: { method: "GET", url: "/users" },
    });

    expect(res.protocol).toBe("rest");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.url).toBe("/users");
    expect(res.data).toEqual({ ok: true, url: "/users" });
  });

  it("lazily resolves and registers the sender via the manager", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const res = await core.send({
      protocol: "rest",
      input: { method: "GET", url: "/lazy" },
    });

    expect(res.url).toBe("/lazy");
    expect(core.getSender("rest")).toBeDefined();
  });

  it("uses config.customTransport over auto-selected transports", async () => {
    const custom = makeMockTransport({ status: 201 });
    const core = new HyperCore({ customTransport: custom });
    core.registerSender(new RestSender());

    const res = await core.send({
      protocol: "rest",
      input: { method: "GET", url: "/custom" },
    });

    expect(res.status).toBe(201);
    expect(res.url).toBe("/custom");
  });

  it("uses config.customSender instead of the default sender for its protocol", async () => {
    const custom = new CustomRestSender();
    const core = new HyperCore({ customSender: custom }, makeMockTransport());

    expect(core.getSender("rest")).toBe(custom);

    const res = await core.rest.get("/custom-sender");
    expect(res.data).toEqual({ via: "custom", url: "/custom-sender" });
  });

  it("exposes the core.rest namespace with bound methods", async () => {
    const core = makeCore();
    const res = await core.rest.get("/users", { query: { page: 1 } });

    expect(res.status).toBe(200);
    expect(res.url).toBe("/users?page=1");

    const flat = (core as unknown as { get(url: string): Promise<UniversalResponse> }).get;
    const flatRes = await flat("/flat");
    expect(flatRes.url).toBe("/flat");
  });

  it("exposes namespaces for externally registered protocols", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const connect = vi.fn(
      (client: { send: (request: unknown) => Promise<unknown> }, peerUrl: string) =>
        client.send({ protocol: "webrtc", input: { peerUrl } }),
    );

    core.registerProtocol({
      protocol: "webrtc",
      sender: {
        protocol: "webrtc",
        methods: { connect },
        prepare: (request) => request.input,
        send: async (prepared) => prepared,
        parse: (raw) => ({
          protocol: "webrtc",
          ok: true,
          status: 200,
          headers: {},
          data: raw,
        }),
      },
    });

    const webrtc = (
      core as unknown as {
        webrtc: { connect(peerUrl: string): Promise<UniversalResponse<{ peerUrl: string }>> };
      }
    ).webrtc;
    const response = await webrtc.connect("webrtc://peer.example");

    expect(connect).toHaveBeenCalledOnce();
    expect(response.data).toEqual({ peerUrl: "webrtc://peer.example" });
  });

  it("lazily resolves the sender when the rest namespace is used without registration", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const res = await core.rest.get("/lazy-rest");

    expect(res.status).toBe(200);
    expect(res.url).toBe("/lazy-rest");
    expect(core.getSender("rest")).toBeDefined();
  });

  it("reports the current transport name", async () => {
    const core = makeCore();
    const name = await core.getTransportName();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("reports the sender name for the rest protocol", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const name = await core.getSenderName("rest");
    expect(name).toBe("RestSender");
  });

  it("reports the receiver name for the rest protocol", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const name = await core.getReceiverName("rest");
    expect(name).toBe("RestReceiver");
  });

  it("reports the protocol module name for the rest protocol", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const name = await core.getProtocolName("rest");
    expect(name).toBe("RestProtocol");
  });

  it("throws when asking for a receiver name of a client-only protocol", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const sender: HyperSender<unknown, unknown, unknown, unknown, "ws"> = {
      protocol: "ws",
      prepare: (request) => request.input,
      send: async (prepared) => prepared,
      parse: (raw) => ({
        protocol: "ws",
        ok: true,
        status: 0,
        headers: {},
        data: raw,
      }),
    };
    const clientOnly: HyperProtocol<unknown, unknown, unknown, unknown, "ws"> = {
      protocol: "ws",
      sender,
    };
    core.registerProtocol(clientOnly);
    await expect(core.getReceiverName("ws")).rejects.toThrow(/has no receiver/);
  });

  it("ignores inherited enumerable protocol methods", () => {
    const inherited = vi.fn();
    const methods = Object.create({ inherited });
    methods.own = vi.fn();
    const core = makeCore();

    core.registerProtocol({
      protocol: "custom",
      sender: {
        protocol: "custom",
        methods,
        prepare: (request) => request.input,
        send: async (prepared) => prepared,
        parse: (raw) => ({ protocol: "custom", ok: true, status: 200, headers: {}, data: raw }),
      },
    });

    expect((core as unknown as Record<string, unknown>).own).toBeTypeOf("function");
    expect((core as unknown as Record<string, unknown>).inherited).toBeUndefined();
  });

  it("exposes lazy namespaces for other known protocols", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const graphql = (core as unknown as Record<string, unknown>).graphql as {
      get(...args: unknown[]): Promise<unknown>;
    };

    await expect(graphql.get("/q")).rejects.toThrow(/No protocol available/);
    expect(core.getSender("graphql")).toBeUndefined();
  });

  it("runs onRequest / onResponse plugin hooks", async () => {
    const core = makeCore();
    const calls: string[] = [];
    core.use({
      name: "spy",
      onRequest: () => {
        calls.push("onRequest");
      },
      onResponse: () => {
        calls.push("onResponse");
      },
    });

    await core.send({ protocol: "rest", input: { method: "GET", url: "/users" } });
    expect(calls).toEqual(["onRequest", "onResponse"]);
  });

  it("applies plugins registered during a request only to later requests", async () => {
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const late = vi.fn();
    const core = makeCore();
    core.use({
      name: "pause",
      onRequest: async () => paused,
    });

    const first = core.send({ protocol: "rest", input: { method: "GET", url: "/first" } });
    await Promise.resolve();
    core.use({ name: "late", onRequest: late });
    resume();
    await first;

    expect(late).not.toHaveBeenCalled();

    await core.send({ protocol: "rest", input: { method: "GET", url: "/second" } });
    expect(late).toHaveBeenCalledOnce();
  });

  it("short-circuits the request when onRequest returns a response", async () => {
    const transport = makeMockTransport();
    const spy = vi.spyOn(transport, "execute");

    const core = new HyperCore({}, transport);
    core.registerSender(new RestSender());
    core.use({
      name: "blocker",
      onRequest: () =>
        ({
          protocol: "rest",
          ok: false,
          status: 418,
          headers: {},
          url: "",
          data: null,
        }) as UniversalResponse,
    });

    const res = await core.send({ protocol: "rest", input: { method: "GET", url: "/blocked" } });
    expect(res.status).toBe(418);
    expect(spy).not.toHaveBeenCalled();
  });

  it("recovers errors via onError plugin", async () => {
    const transport = {
      async execute() {
        throw new HyperClientError("boom");
      },
    };
    const core = new HyperCore({}, transport);
    core.registerSender(new RestSender());
    core.use({
      name: "recover",
      onError: () =>
        ({
          protocol: "rest",
          ok: false,
          status: 503,
          headers: {},
          url: "",
          data: null,
        }) as UniversalResponse,
    });

    const res = await core.send({ protocol: "rest", input: { method: "GET", url: "/fail" } });
    expect(res.status).toBe(503);
  });

  it("selects the sender for the protocol returned by onRequest", async () => {
    const core = makeCore();
    const customSend = vi.fn(async (prepared: { url: string }) => prepared);
    const customSender: HyperSender<any, any, any, any> = {
      protocol: "custom",
      prepare: (request) => request.input,
      send: customSend,
      parse: (raw) => ({
        protocol: "custom",
        ok: true,
        status: 200,
        headers: {},
        url: raw.url,
        data: "custom",
      }),
    };
    core.registerSender(customSender);
    core.use({
      name: "switch-protocol",
      onRequest: () => ({
        protocol: "custom",
        input: { method: "GET", url: "/mutated" },
      }),
    });

    const response = await core.send({
      protocol: "rest",
      input: { method: "GET", url: "/original" },
    });

    expect(customSend).toHaveBeenCalledOnce();
    expect(response.protocol).toBe("custom");
    expect(response.url).toBe("/mutated");
  });

  it("routes onRequest failures through onError", async () => {
    const failure = new Error("request plugin failed");
    const recover = vi.fn(
      () =>
        ({
          protocol: "rest",
          ok: false,
          status: 503,
          headers: {},
          data: null,
        }) as UniversalResponse,
    );
    const core = makeCore();
    core.use({
      name: "throw-request",
      onRequest: () => {
        throw failure;
      },
    });
    core.use({ name: "recover-request", onError: recover });

    const response = await core.send({
      protocol: "rest",
      input: { method: "GET", url: "/plugin-error" },
    });

    expect(recover).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ protocol: "rest" }),
      expect.anything(),
      expect.anything(),
    );
    expect(response.status).toBe(503);
  });

  it("runs response hooks for an onRequest short-circuit response", async () => {
    const onResponse = vi.fn();
    const core = makeCore();
    core.use({
      name: "short-circuit",
      onRequest: () => ({
        protocol: "rest",
        ok: true,
        status: 204,
        headers: {},
        data: null,
      }),
    });
    core.use({ name: "observe-response", onResponse });

    await core.send({ protocol: "rest", input: { method: "GET", url: "/short" } });
    expect(onResponse).toHaveBeenCalledOnce();
  });

  it("getSender, extend and create clone the core", async () => {
    const core = makeCore();
    expect(core.getSender("rest")).toBeDefined();

    const extended = core.extend({ verbose: true });
    expect(extended).toBeInstanceOf(HyperCore);
    expect(extended.config.verbose).toBe(true);

    const created = core.create({});
    expect(created).toBeInstanceOf(HyperCore);
  });

  it("destroy closes the transport", async () => {
    const transport = makeMockTransport();
    const core = makeCore(transport);
    await core.destroy();
    expect(transport.close).toHaveBeenCalled();
  });

  it("keeps a shared transport open until every extended core is destroyed", async () => {
    const transport = makeMockTransport();
    const parent = new HyperCore({}, transport);
    parent.registerSender(new RestSender());
    const child = parent.extend({ verbose: true });
    expect(child.config.verbose).toBe(true);

    await parent.destroy();
    expect(transport.close).not.toHaveBeenCalled();

    await child.destroy();
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("create() initializes an independent core without holding the parent transport", async () => {
    const transport = makeMockTransport();
    const core = new HyperCore({}, transport);
    core.registerSender(new RestSender());

    const created = core.create({});
    expect(created).toBeInstanceOf(HyperCore);
    expect(
      (created as unknown as { config: { customTransport?: unknown } }).config.customTransport,
    ).toBeUndefined();

    await created.destroy();
    expect(transport.close).not.toHaveBeenCalled();

    await core.destroy();
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("create() does not inherit customTransport from the parent config", () => {
    const custom = makeMockTransport();
    const core = new HyperCore({ customTransport: custom });

    const created = core.create({});
    expect(
      (created as unknown as { config: { customTransport?: unknown } }).config.customTransport,
    ).toBeUndefined();

    const explicit = makeMockTransport();
    const overridden = core.create({ customTransport: explicit });
    expect(
      (overridden as unknown as { config: { customTransport?: unknown } }).config.customTransport,
    ).toBe(explicit);
  });

  it("generates unique request ids across many requests", async () => {
    const ids = new Set<string>();
    class IdSender implements HyperSender<any, any, any, any> {
      readonly protocol = "rest";
      prepare(request: any, ctx: RequestContext) {
        ids.add(ctx.requestId);
        return request.input;
      }
      async send(prepared: any) {
        return prepared;
      }
      parse(raw: any) {
        return {
          protocol: "rest",
          ok: true,
          status: 200,
          headers: {},
          data: raw,
        };
      }
    }

    const core = new HyperCore({}, makeMockTransport());
    core.registerSender(new IdSender());

    for (let i = 0; i < 1000; i++) {
      await core.send({ protocol: "rest", input: { method: "GET", url: `/r/${i}` } });
    }

    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    }
  });

  it("retries transport resolution after a transient capability failure", async () => {
    let supported = false;
    const transport: HyperTransport = {
      ...makeMockTransport(),
      supports: () => supported,
    };
    const core = new HyperCore({ customTransport: transport });
    core.registerSender({
      protocol: "custom",
      prepare: (request) => request.input,
      send: async (prepared) => prepared,
      parse: (raw) => ({ protocol: "custom", ok: true, status: 200, headers: {}, data: raw }),
    });

    await expect(core.send({ protocol: "custom", input: { url: "/retry" } })).rejects.toThrow(
      /does not support protocol/,
    );

    supported = true;
    await expect(
      core.send({ protocol: "custom", input: { url: "/retry" } }),
    ).resolves.toMatchObject({
      protocol: "custom",
      status: 200,
    });
    await core.destroy();
  });

  it("retains a lazily resolved transport exactly once under concurrent startup", async () => {
    const transport = makeMockTransport();
    const core = new HyperCore({ customTransport: transport });
    core.registerSender(new RestSender());

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        core.send({ protocol: "rest", input: { method: "GET", url: `/r/${i}` } }),
      ),
    );
    expect(results).toHaveLength(100);

    await core.destroy();
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("retains the transport when listen() resolves it lazily", async () => {
    const serverHandle = { close: vi.fn(async () => {}) };
    const transport = {
      ...makeMockTransport(),
      listen: vi.fn(async () => serverHandle),
    };
    const core = new HyperCore({ customTransport: transport });

    const server = await core.listen({ protocol: "rest" });
    expect(server.close).toBeTypeOf("function");

    await core.destroy();
    expect(serverHandle.close).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("closes a server that resolves after destroy starts", async () => {
    let resolveListen!: (server: TransportServer) => void;
    const server = { close: vi.fn(async () => {}) };
    const transport = {
      ...makeMockTransport(),
      listen: vi.fn(
        () =>
          new Promise<TransportServer>((resolve) => {
            resolveListen = resolve;
          }),
      ),
    };
    const core = new HyperCore({ customTransport: transport });
    const listening = core.listen({ protocol: "rest" });

    await vi.waitFor(() => expect(transport.listen).toHaveBeenCalledOnce());
    const destroying = core.destroy();
    resolveListen(server);

    await Promise.allSettled([listening, destroying]);
    expect(server.close).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("rejects REST timeouts with TimeoutError", async () => {
    vi.useFakeTimers();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const transport: HyperTransport = {
      execute(request) {
        markStarted();
        return new Promise((_resolve, reject) => {
          const rejectAbort = () => reject(request.signal?.reason);
          if (request.signal?.aborted) rejectAbort();
          else request.signal?.addEventListener("abort", rejectAbort, { once: true });
        });
      },
      close: vi.fn(async () => {}),
    };
    const core = new HyperCore({}, transport);
    core.registerSender(new RestSender());

    try {
      const failure = core.rest.get("/slow", { timeout: 10 }).then(
        () => undefined,
        (error: unknown) => error,
      );
      await started;
      await vi.advanceTimersByTimeAsync(10);
      const error = await failure;

      expect(error).toBeInstanceOf(TimeoutError);
      expect(TimeoutError.isTimeoutError(error)).toBe(true);
      expect(error).toMatchObject({ code: "TIMEOUT", statusCode: 408, url: "/slow" });
    } finally {
      await core.destroy();
      vi.useRealTimers();
    }
  });
});

describe("HyperCore lifecycle regressions", () => {
  it("graceful destroy waits for accepted requests including settlement", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transport = {
      ...makeMockTransport(),
      execute: async () => {
        started();
        await gate;
        return { status: 200, headers: {}, body: undefined };
      },
    };
    const core = makeCore(transport);
    const request = core.rest.get("/active");
    await entered;
    let done = false;
    const destroying = core.destroy();
    expect(core.destroy()).toBe(destroying);
    void destroying.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(transport.close).not.toHaveBeenCalled();
    finish();
    await request;
    await destroying;
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("settles exactly once after recovery and isolates failing settlement callbacks", async () => {
    const outcomes: unknown[] = [];
    const core = makeCore({
      execute: async () => {
        throw new Error("network");
      },
    });
    core.config.logger = vi.fn();
    core.use({
      name: "resource",
      onRequest(_request, _plugin, ctx) {
        ctx?.onSettled?.((outcome) => {
          outcomes.push(outcome);
          throw new Error("diagnostic");
        });
        ctx?.onSettled?.((outcome) => {
          outcomes.push(outcome);
        });
      },
    });
    core.use({
      name: "recover",
      onError: () => ({ protocol: "rest", ok: true, status: 200, headers: {}, data: "recovered" }),
    });
    const response = await core.rest.get("/settle");
    expect(outcomes).toEqual([
      { ok: true, response },
      { ok: true, response },
    ]);
    await core.destroy();
  });

  it("rejects settlement registration after finalization starts", async () => {
    let context: RequestContext | undefined;
    const core = makeCore();
    core.use({
      name: "observe",
      onRequest(_request, _plugin, ctx) {
        context = ctx;
      },
    });
    await core.rest.get("/settle");
    expect(() => context?.onSettled?.(() => {})).toThrow(/settlement/);
    await core.destroy();
  });

  it("infers output from the documented single send generic", async () => {
    const core = makeCore();
    const result = core.send<{ ok: boolean }>({
      protocol: "rest",
      input: { method: "GET", url: "/types" },
    });
    expectTypeOf(result).toEqualTypeOf<Promise<UniversalResponse<{ ok: boolean }>>>();
    expect((await result).data.ok).toBe(true);
    await core.destroy();
  });

  const response = () => ({ protocol: "rest", ok: true, status: 200, headers: {}, data: "ok" });

  it("reports a failure while processing a recovered response without retrying recovery", async () => {
    const original = new Error("sender failed");
    const failure = new Error("recovered response failed");
    const errors: unknown[] = [];
    const responses = vi.fn(() => {
      throw failure;
    });
    const core = makeCore({
      execute: async () => {
        throw original;
      },
    });
    core.use({
      name: "recover",
      onError: (error) => {
        errors.push(error);
        return response();
      },
    });
    core.use({ name: "response", onResponse: responses });
    await expect(core.rest.get("/local")).rejects.toBe(failure);
    expect(errors).toEqual([original, failure]);
    expect(responses).toHaveBeenCalledOnce();
    await core.destroy();
  });

  it("runs remaining error hooks and response hooks after recovery", async () => {
    const cleanup = vi.fn();
    const observed = vi.fn();
    const core = makeCore({
      execute: async () => {
        throw new Error("original");
      },
    });
    core.use({ name: "recover", onError: response });
    core.use({
      name: "throwing",
      onError() {
        throw new Error("hook");
      },
    });
    core.use({ name: "cleanup", onError: cleanup, onResponse: observed });
    const logger = vi.fn();
    core.config.logger = logger;
    expect((await core.rest.get("/local")).data).toBe("ok");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledOnce();
    await core.destroy();
  });

  it("preserves each plugin request identity through replacements", async () => {
    const core = makeCore();
    let original: unknown;
    let terminal: unknown;
    core.use({
      name: "primary",
      onRequest(req) {
        original = req;
      },
      onResponse(_res, req) {
        terminal = req;
      },
    });
    core.use({ name: "replace", phase: "FORMAT", onRequest: (req) => ({ ...req }) });
    await core.rest.get("/local");
    expect(terminal).toBe(original);
    await core.destroy();
  });

  it("deduplicates instances and rejects unsafe cross-core reuse before setup", async () => {
    const setup = vi.fn();
    const hook = vi.fn();
    const plugin = { name: "unique", setup, onRequest: hook };
    const core = makeCore();
    core.use(plugin).use(plugin);
    expect(setup).toHaveBeenCalledOnce();
    const other = makeCore();
    expect(() => other.use(plugin)).toThrow(/cannot be shared/);
    await core.rest.get("/local");
    expect(hook).toHaveBeenCalledOnce();
    await core.destroy();
    await other.destroy();
  });

  it("requires fresh configured plugins when cloning a core", async () => {
    const plugin = { name: "configured" };
    const core = new HyperCore({ plugins: [plugin] });
    expect(() => core.create({})).toThrow(/cannot be shared/);
    const child = core.create({ plugins: [{ name: "fresh" }] });
    await child.destroy();
    await core.destroy();
  });

  it("rejects cached and short-circuit sends once shutdown starts", async () => {
    let finish!: () => void;
    const close = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const core = makeCore({ ...makeMockTransport(), close: () => close });
    await core.rest.get("/warm");
    const destroying = core.destroy();
    await expect(core.rest.get("/late")).rejects.toThrow(/destroyed/);
    finish();
    await destroying;
    const cached = new HyperCore({ plugins: [{ name: "cached", onRequest: response }] });
    await cached.destroy();
    await expect(
      cached.send({ protocol: "rest", input: { method: "GET", url: "/late" } }),
    ).rejects.toThrow(/destroyed/);
  });

  it("waits for pending listeners and closes their late server", async () => {
    let finish!: (server: TransportServer) => void;
    const transport = {
      ...makeMockTransport(),
      listen: vi.fn(
        () =>
          new Promise<TransportServer>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const core = new HyperCore({}, transport);
    const listening = core.listen({ protocol: "rest" });
    const result = listening.catch((error) => error);
    await vi.waitFor(() => expect(transport.listen).toHaveBeenCalledOnce());
    let destroyed = false;
    const destroying = core.destroy().then(() => {
      destroyed = true;
    });
    await Promise.resolve();
    expect(destroyed).toBe(false);
    const server = { close: vi.fn(async () => {}) };
    finish(server);
    await destroying;
    expect(await result).toBeInstanceOf(Error);
    expect(server.close).toHaveBeenCalledOnce();
  });

  it("closes manually stopped servers exactly once", async () => {
    const native = { close: vi.fn(async () => {}) };
    const core = new HyperCore({}, { ...makeMockTransport(), listen: async () => native });
    const server = await core.listen({ protocol: "rest" });
    const first = server.close();
    expect(server.close()).toBe(first);
    await first;
    await core.destroy();
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("rejects sends during setup without retaining the injected transport twice", async () => {
    const transport = makeMockTransport();
    let request: Promise<unknown> | undefined;
    const core = new HyperCore(
      {
        senders: [new RestSender()],
        plugins: [
          {
            name: "startup",
            setup({ core }) {
              request = core.send({ protocol: "rest", input: { method: "GET", url: "/setup" } });
            },
          },
        ],
      },
      transport,
    );
    await expect(request).rejects.toThrow(/initialization/);
    await core.destroy();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("does not retain an injected transport when setup throws", async () => {
    const transport = makeMockTransport();
    expect(
      () =>
        new HyperCore(
          {
            plugins: [
              {
                name: "bad",
                setup() {
                  throw new Error("setup");
                },
              },
            ],
          },
          transport,
        ),
    ).toThrow("setup");
    const core = new HyperCore({}, transport);
    await core.destroy();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("removes obsolete generated methods on sender replacement", async () => {
    const core = makeCore();
    const sender = new CustomRestSender();
    core.registerSender(sender);
    expect((core as unknown as Record<string, unknown>).post).toBeUndefined();
    await core.destroy();
  });

  it("keeps shutdown running when the configured logger throws", async () => {
    const core = makeCore({
      ...makeMockTransport(),
      close() {
        throw new Error("close");
      },
    });
    core.config.logger = () => {
      throw new Error("logger");
    };
    await expect(core.destroy()).resolves.toBeUndefined();
  });
});
