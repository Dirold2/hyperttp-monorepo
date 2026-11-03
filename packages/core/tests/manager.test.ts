import { describe, it, expect, afterEach, vi } from "vitest";
import {
  KNOWN_PROTOCOLS,
  resetCachedProtocols,
  resolveProtocol,
  resolveReceiver,
  resolveSender,
} from "../src/protocols/manager.js";
import { HyperCore } from "../src/index.js";
import * as modules from "../src/utils/modules.js";

function deferredModule() {
  let resolve!: (module: Record<string, unknown>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Record<string, unknown>>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("protocol manager", () => {
  afterEach(() => {
    resetCachedProtocols();
    vi.restoreAllMocks();
  });

  it("does not overwrite explicit registration while lazy loading is pending", async () => {
    const loaded = deferredModule();
    vi.spyOn(modules, "dynamicImport").mockReturnValue(loaded.promise);
    const core = new HyperCore();
    const resolving = core.getProtocolName("grpc");
    const sender = {
      protocol: "grpc" as const,
      prepare: (request: { input: unknown }) => request.input,
      send: async (prepared: unknown) => prepared,
      parse: (raw: unknown) => ({
        protocol: "grpc" as const,
        ok: true,
        status: 200,
        headers: {},
        data: raw,
      }),
    };
    const explicit = { protocol: "grpc" as const, name: "explicit", sender };
    core.registerProtocol(explicit);
    loaded.resolve({ GrpcProtocol: { ...explicit, name: "lazy" } });
    expect(await resolving).toBe("explicit");
    expect(core.getProtocol("grpc")).toBe(explicit);
    await core.destroy();
  });

  it("resolves the rest sender", async () => {
    const sender = await resolveSender("rest");

    expect(sender).toBeDefined();
    expect(sender.protocol).toBe("rest");
  });

  it("caches the resolved sender per protocol", async () => {
    const first = await resolveSender("rest");
    const second = await resolveSender("rest");

    expect(second).toBe(first);
  });

  it("throws for a packaged protocol sender that is not installed", async () => {
    await expect(resolveSender("grpc")).rejects.toThrow(
      /No protocol available for "grpc".*@hyperttp\/protocol-grpc/,
    );
  });

  it("does not resolve an unknown protocol", async () => {
    await expect(resolveSender("custom-unknown")).rejects.toThrow(
      /No protocol available for "custom-unknown"/,
    );
  });

  it("does not resolve the legacy 'http' protocol name", async () => {
    await expect(resolveSender("http")).rejects.toThrow(/No protocol available for "http"/);
  });

  it("deduplicates concurrent lazy construction across protocol and role resolution", async () => {
    const loaded = deferredModule();
    const loader = vi.spyOn(modules, "dynamicImport").mockReturnValue(loaded.promise);
    const constructed = vi.fn();
    class MockProtocol {
      protocol = "grpc" as const;
      sender = { protocol: "grpc" as const };
      receiver = { protocol: "grpc" as const };
      constructor(options: unknown) {
        constructed(options);
      }
    }
    const options = { first: true };
    const first = resolveProtocol("grpc", options);
    const second = resolveProtocol("grpc", { first: false });
    const sender = resolveSender("grpc");
    const receiver = resolveReceiver("grpc");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith("@hyperttp/protocol-grpc");
    loaded.resolve({ GrpcProtocol: MockProtocol });

    const instance = await first;
    expect(await second).toBe(instance);
    expect(await sender).toBe(instance.sender);
    expect(await receiver).toBe(instance.receiver);
    expect(await resolveProtocol("grpc")).toBe(instance);
    expect(constructed).toHaveBeenCalledExactlyOnceWith(options);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("retries after a shared module load rejection", async () => {
    const loaded = deferredModule();
    const error = new Error("loader failed");
    const instance = { protocol: "grpc" };
    const loader = vi
      .spyOn(modules, "dynamicImport")
      .mockReturnValueOnce(loaded.promise)
      .mockResolvedValue({ default: instance });
    const first = expect(resolveProtocol("grpc")).rejects.toBe(error);
    const second = expect(resolveProtocol("grpc")).rejects.toBe(error);
    loaded.reject(error);
    await Promise.all([first, second]);

    expect(await resolveProtocol("grpc")).toBe(instance);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("retries after a constructor throws", async () => {
    const error = new Error("construction failed");
    const construct = vi.fn().mockImplementationOnce(() => {
      throw error;
    });
    class MockProtocol {
      protocol = "grpc";
      constructor() {
        construct();
      }
    }
    const loader = vi
      .spyOn(modules, "dynamicImport")
      .mockResolvedValue({ GrpcProtocol: MockProtocol });
    await expect(resolveProtocol("grpc")).rejects.toBe(error);
    expect(await resolveProtocol("grpc")).toBeInstanceOf(MockProtocol);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("retries missing and invalid modules without caching failures", async () => {
    const instance = { protocol: "grpc" };
    const loader = vi
      .spyOn(modules, "dynamicImport")
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ERR_MODULE_NOT_FOUND" }))
      .mockResolvedValueOnce({ default: {} })
      .mockResolvedValueOnce({ default: instance });
    await expect(resolveProtocol("grpc")).rejects.toThrow(/No protocol available.*protocol-grpc/);
    await expect(resolveProtocol("grpc")).rejects.toThrow(/No protocol available.*protocol-grpc/);
    expect(await resolveProtocol("grpc")).toBe(instance);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("does not repopulate the cache when an old load finishes after reset", async () => {
    const old = deferredModule();
    const stale = { protocol: "grpc" };
    const current = { protocol: "grpc" };
    const loader = vi
      .spyOn(modules, "dynamicImport")
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ default: current });
    const first = resolveProtocol("grpc");
    resetCachedProtocols();
    expect(await resolveProtocol("grpc")).toBe(current);
    old.resolve({ default: stale });
    expect(await first).toBe(stale);
    expect(await resolveProtocol("grpc")).toBe(current);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)(
    "does not clear a new pending load when an old load settles by %s",
    async (outcome) => {
      const old = deferredModule();
      const fresh = deferredModule();
      const loader = vi
        .spyOn(modules, "dynamicImport")
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise);
      const first = resolveProtocol("grpc");
      const settled = first.catch(() => undefined);
      resetCachedProtocols();
      const second = resolveProtocol("grpc");
      if (outcome === "resolve") old.resolve({ default: { protocol: "grpc" } });
      else old.reject(new Error("stale failure"));
      await settled;
      const third = resolveProtocol("grpc");
      expect(loader).toHaveBeenCalledTimes(2);
      const current = { protocol: "grpc" };
      fresh.resolve({ default: current });
      expect(await second).toBe(current);
      expect(await third).toBe(current);
      expect(await resolveProtocol("grpc")).toBe(current);
    },
  );

  it.each([
    ["ws", "websocket"],
    ["websocket", "ws"],
  ] as const)("accepts the %s alias with module protocol %s", async (alias, protocol) => {
    const instance = { protocol };
    const loader = vi
      .spyOn(modules, "dynamicImport")
      .mockResolvedValue({ WebSocketProtocol: instance });
    expect(await resolveProtocol(alias)).toBe(instance);
    expect(await resolveProtocol(alias)).toBe(instance);
    expect(loader).toHaveBeenCalledExactlyOnceWith("@hyperttp/protocol-websocket");
  });

  it("exposes the known protocol list including rest", () => {
    expect(KNOWN_PROTOCOLS).toContain("rest");
    expect(KNOWN_PROTOCOLS).toContain("graphql");
    expect(KNOWN_PROTOCOLS).toContain("grpc");
  });
});
