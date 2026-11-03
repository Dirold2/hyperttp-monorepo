import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HyperCore } from "../src/index.js";
import {
  evictCachedTransport,
  getCachedTransport,
  resolveTransport,
  resetCachedTransport,
} from "../src/transports/manager.js";
import * as modules from "../src/utils/modules.js";
import { FetchTransport } from "../src/transports/fetch.js";
import type { HyperSender, HyperTransport, TransportRequest } from "@hyperttp/types";

afterEach(() => {
  resetCachedTransport();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeRequest(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    method: "GET",
    url: "https://example.com/",
    headers: {},
    protocol: "rest",
    ...overrides,
  };
}

describe("resolveTransport fallback", () => {
  it("falls back to the built-in FetchTransport when no packaged transport is installed", async () => {
    const transport = await resolveTransport("rest");
    expect(transport).toBeInstanceOf(FetchTransport);
  });

  it("caches the resolved transport per protocol", async () => {
    const first = await resolveTransport("rest");
    const second = await resolveTransport("rest");
    expect(second).toBe(first);
  });

  it("returns a fresh instance after resetCachedTransport", async () => {
    const first = await resolveTransport("rest");
    resetCachedTransport();
    const second = await resolveTransport("rest");
    expect(second).toBeInstanceOf(FetchTransport);
    expect(second).not.toBe(first);
  });

  it("throws for a protocol with no available transport", async () => {
    await expect(resolveTransport("grpc")).rejects.toThrow(/No transport available/);
  });

  it.each([
    ["webrtc", "@hyperttp/transport-webrtc"],
    ["websocket", "@hyperttp/transport-websocket"],
    ["mqtt", "@hyperttp/transport-mqtt"],
  ])("explains how to install the required %s transport", async (protocol, transportPackage) => {
    await expect(resolveTransport(protocol)).rejects.toThrow(`Install "${transportPackage}"`);
  });

  it("defaults the protocol to http when omitted", async () => {
    const transport = await resolveTransport();
    expect(transport).toBeInstanceOf(FetchTransport);
    expect(transport.protocols).toContain("rest");
  });

  it("prioritizes the custom transport from config over auto-selection", async () => {
    const custom = new FetchTransport({ protocols: ["rest"] });
    const transport = await resolveTransport("rest", { customTransport: custom });
    expect(transport).toBe(custom);
  });

  it("uses the custom transport even when an auto transport is cached", async () => {
    await resolveTransport("rest");
    const custom = new FetchTransport({ protocols: ["rest"] });
    const transport = await resolveTransport("rest", { customTransport: custom });
    expect(transport).toBe(custom);
  });

  it("uses FetchTransport for listen when a custom transport has no listen()", async () => {
    const clientOnly = {
      async execute(req: TransportRequest) {
        return { status: 200, headers: {}, url: req.url, body: undefined };
      },
    } as HyperTransport;

    const clientTransport = await resolveTransport("rest", { customTransport: clientOnly });
    const serverTransport = await resolveTransport("rest", {
      customTransport: clientOnly,
      requireListen: true,
    });

    expect(clientTransport).toBe(clientOnly);
    expect(serverTransport).toBeInstanceOf(FetchTransport);
    expect(getCachedTransport("rest")).toBeUndefined();
  });

  it("evicts every scoped cache entry without closing the transport", async () => {
    const config = { maxBodyBytes: 100 };
    const first = await resolveTransport("rest", config);
    const close = vi.spyOn(first, "close");
    expect(getCachedTransport("rest", config)).toBe(first);
    evictCachedTransport(first);
    expect(getCachedTransport("rest", config)).toBeUndefined();
    expect(close).not.toHaveBeenCalled();
    expect(await resolveTransport("rest", config)).not.toBe(first);
  });

  it("keeps an automatically resolved transport alive for an extended core", async () => {
    const parent = new HyperCore();
    await parent.getTransportName();
    const close = vi.spyOn(FetchTransport.prototype, "close");
    const child = parent.extend({}) as HyperCore;

    await parent.destroy();
    expect(close).not.toHaveBeenCalled();
    expect(await child.getTransportName()).toBe("FetchTransport");

    await child.destroy();
    expect(close).toHaveBeenCalledOnce();
    expect(getCachedTransport("rest")).toBeUndefined();
  });

  it("resolves the dispatched protocol using the core configuration", async () => {
    const customTransport = await resolveTransport("custom", { protocols: ["custom"] });
    let usedTransport: HyperTransport | undefined;

    const sender: HyperSender<any, any, any, any> = {
      protocol: "custom",
      prepare: (request) => request.input,
      send: async (prepared, transport) => {
        usedTransport = transport;
        return prepared;
      },
      parse: (raw) => ({
        protocol: "custom",
        ok: true,
        status: 200,
        headers: {},
        url: raw.url,
        data: null,
      }),
    };
    const core = new HyperCore({ senders: [sender], customTransport });

    await core.send({
      protocol: "custom",
      input: { method: "GET", url: "/custom", headers: {}, protocol: "custom" },
    });

    expect(usedTransport).toBe(customTransport);
    await core.destroy();
  });
});

describe("transport cache isolation", () => {
  it("does not leak a custom transport into an empty default cache", async () => {
    const custom = { execute: vi.fn() } as unknown as HyperTransport;
    await resolveTransport("rest", { customTransport: custom });
    expect(getCachedTransport("rest")).toBeUndefined();
    expect(await resolveTransport("rest")).not.toBe(custom);
  });

  it("never publishes custom transports or their listen fallbacks to defaults", async () => {
    const automatic = await resolveTransport("rest");
    const custom = { execute: vi.fn() } as unknown as HyperTransport;
    expect(await resolveTransport("rest", { customTransport: custom })).toBe(custom);
    await resolveTransport("rest", { customTransport: custom, requireListen: true });
    expect(getCachedTransport("rest")).toBe(automatic);
    expect(getCachedTransport("rest", { requireListen: true })).toBeUndefined();
    expect(await resolveTransport("rest")).toBe(automatic);
  });

  it("isolates options and deduplicates concurrent calls by stable config identity", async () => {
    const constructed: unknown[] = [];
    class MockTransport {
      constructor(options: unknown) {
        constructed.push(options);
      }
      execute = vi.fn();
    }
    vi.spyOn(modules, "dynamicImport").mockResolvedValue({ default: MockTransport });
    const cacheKey = {};
    const logger = vi.fn();
    const firstConfig = { cacheKey, maxBodyBytes: 1, logger };
    const secondConfig = { cacheKey: {}, maxBodyBytes: 2, logger: vi.fn() };
    const [first, shared, second] = await Promise.all([
      resolveTransport("rest", firstConfig),
      resolveTransport("rest", { ...firstConfig }),
      resolveTransport("rest", secondConfig),
    ]);
    expect(shared).toBe(first);
    expect(second).not.toBe(first);
    expect(constructed).toEqual([firstConfig, secondConfig]);
    expect(getCachedTransport("rest", { cacheKey })).toBe(first);
    expect(getCachedTransport("rest")).toBeUndefined();
  });

  it("isolates automatic transport options across independent cores", async () => {
    const options: unknown[] = [];
    class MockTransport {
      constructor(config: unknown) {
        options.push(config);
      }
      execute = vi.fn();
      close = vi.fn();
    }
    vi.spyOn(modules, "dynamicImport").mockResolvedValue({ default: MockTransport });
    const firstLogger = vi.fn();
    const secondLogger = vi.fn();
    const first = new HyperCore({ logger: firstLogger });
    const second = new HyperCore({ logger: secondLogger });
    try {
      await Promise.all([first.getTransportName(), second.getTransportName()]);
      expect(options).toHaveLength(2);
      expect(options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ logger: firstLogger }),
          expect.objectContaining({ logger: secondLogger }),
        ]),
      );
    } finally {
      await Promise.all([first.destroy(), second.destroy()]);
    }
  });

  it("does not share distinct configuration objects without an explicit identity", async () => {
    const config = { maxBodyBytes: 1 };
    const first = await resolveTransport("rest", config);
    expect(await resolveTransport("rest", config)).toBe(first);
    expect(await resolveTransport("rest", { ...config })).not.toBe(first);
  });

  it("separates client and listener roles from protocols containing role suffixes", async () => {
    class ClientTransport {
      execute = vi.fn();
    }
    vi.spyOn(modules, "dynamicImport").mockResolvedValue({ default: ClientTransport });
    const cacheKey = {};
    const listener = await resolveTransport("rest", { cacheKey, requireListen: true });
    const client = await resolveTransport("rest", { cacheKey });
    const suffixed = await resolveTransport("rest:listen", { cacheKey });
    expect(listener).toBeInstanceOf(FetchTransport);
    expect(client).toBeInstanceOf(ClientTransport);
    expect(suffixed).toBeInstanceOf(ClientTransport);
    expect(suffixed).not.toBe(listener);
    expect(suffixed).not.toBe(client);
    expect(getCachedTransport("rest", { cacheKey, requireListen: true })).toBe(listener);
    expect(getCachedTransport("rest", { cacheKey })).toBe(client);
  });

  it("propagates logger errors and permits a retry", async () => {
    const error = new Error("logger failed");
    const logger = vi.fn((): void => {
      throw error;
    });
    const config = { logger };
    await expect(resolveTransport("rest", config)).rejects.toBe(error);
    logger.mockImplementation(() => {});
    await expect(resolveTransport("rest", config)).resolves.toBeInstanceOf(FetchTransport);
  });

  it("does not mistake constructor module-not-found errors for missing packages", async () => {
    const error = Object.assign(new Error("Cannot find module inside constructor"), {
      code: "MODULE_NOT_FOUND",
    });
    vi.spyOn(modules, "dynamicImport").mockResolvedValue({
      default: class {
        constructor() {
          throw error;
        }
      },
    });
    await expect(resolveTransport("rest")).rejects.toBe(error);
  });

  it("does not repopulate the current cache after a reset during resolution", async () => {
    let finish!: (mod: Record<string, unknown>) => void;
    vi.spyOn(modules, "dynamicImport").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = resolveTransport("rest");
    resetCachedTransport();
    finish({
      default: class {
        execute = vi.fn();
      },
    });
    await pending;
    expect(getCachedTransport("rest")).toBeUndefined();
  });
});

describe("FetchTransport", () => {
  it("defaults protocols to http when not specified", () => {
    const transport = new FetchTransport();
    expect(transport.protocols).toEqual(["rest"]);
  });

  it("uses the provided protocol list", () => {
    const transport = new FetchTransport({ protocols: ["rest", "grpc"] });
    expect(transport.protocols).toEqual(["rest", "grpc"]);
  });
  it("executes a request and normalizes the response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FetchTransport();
    const res = await transport.execute(makeRequest({ headers: { accept: "application/json" } }));

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(res.body as Uint8Array)).toBe('{"ok":true}');
    expect(res.headers["content-type"]).toBe("application/json");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("suppresses the body for GET requests", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FetchTransport();
    await transport.execute(makeRequest({ body: "should-not-be-sent" }));

    const [, init] = fetchMock.mock.calls[0]! as unknown as [unknown, RequestInit];
    expect(init.body).toBeNull();
  });

  it("appends duplicate header values", async () => {
    const fetchMock = vi.fn(async () => {
      const res = new Response(null, { status: 200 });
      res.headers.append("set-cookie", "a=1");
      res.headers.append("set-cookie", "b=2");
      return res;
    });
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FetchTransport();
    const res = await transport.execute(makeRequest());

    expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
  });

  it("returns the response body without buffering in stream mode", async () => {
    const response = new Response("streamed", { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    const transport = new FetchTransport();
    const result = await transport.execute({ ...makeRequest(), stream: true } as TransportRequest);

    expect(result.body).toBe(response.body);
  });
});

describe("browser compatibility", () => {
  it("bundles per-file minified package output without external Node modules", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hyperttp-browser-"));
    try {
      // Match the package's per-file build before a consumer bundles its output.
      await build({
        absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
        entryPoints: ["src/**/*.ts"],
        outbase: "src",
        outdir: directory,
        bundle: false,
        platform: "neutral",
        format: "esm",
        minify: true,
        logLevel: "silent",
      });
      const result = await build({
        entryPoints: [join(directory, "index.js")],
        bundle: true,
        platform: "browser",
        format: "esm",
        write: false,
        logLevel: "silent",
      });
      expect(result.outputFiles.length).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("bundles the public entry without Node built-in polyfills", async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      logLevel: "silent",
    });

    expect(result.outputFiles.length).toBeGreaterThan(0);
  });
});
