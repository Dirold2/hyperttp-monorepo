import { describe, expect, it, vi } from "vitest";
import { HyperCore } from "../src/index.js";
import type {
  HyperPlugin,
  TransportListenOptions,
  TransportRequest,
  TransportResponse,
} from "@hyperttp/types";

const raw: TransportRequest = { protocol: "rest", method: "GET", url: "/original", headers: {} };

async function start(
  plugins: HyperPlugin[],
  handler: () => { body: string } = () => ({ body: "ok" }),
) {
  let onRequest: TransportListenOptions["onRequest"];
  const core = new HyperCore(
    { plugins, logger: vi.fn() },
    {
      execute: async () => {
        throw new Error("client I/O must not run");
      },
      listen: async (options) => {
        onRequest = options.onRequest;
        return { close: async () => {} };
      },
    },
  );
  await core.listen({ protocol: "rest", handler });
  return { core, request: (request = raw) => Promise.resolve(onRequest!(request)) };
}

const recovered: TransportResponse = { status: 503, headers: {}, body: "recovered" };

describe("server plugin lifecycle", () => {
  it("transforms incoming raw requests and serialized outgoing responses with a shared context", async () => {
    const seen: unknown[] = [];
    const signal = new AbortController().signal;
    const incoming: HyperPlugin = {
      name: "incoming",
      phase: "START",
      onServerRequest(request, _plugin, ctx) {
        expect(ctx.protocol).toBe("rest");
        seen.push(ctx);
        return { ...request, url: "/changed", signal };
      },
    };
    const outgoing: HyperPlugin = {
      name: "outgoing",
      phase: "DATA",
      mode: "background",
      async onServerResponse(response, request, _plugin, ctx) {
        expect(request.url).toBe("/changed");
        expect(ctx.signal).toBe(signal);
        expect(response.body).toBeInstanceOf(Uint8Array);
        seen.push(ctx);
        await Promise.resolve();
        return { ...response, status: 201, headers: { ...response.headers, "x-server": "yes" } };
      },
      onServerSettled(outcome, _request, _plugin, ctx) {
        expect(outcome.ok).toBe(true);
        seen.push(ctx);
      },
    };
    const { core, request } = await start([outgoing, incoming]);
    try {
      const response = await request();
      expect(response.status).toBe(201);
      expect(response.headers["x-server"]).toBe("yes");
      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(1);
    } finally {
      await core.destroy();
    }
  });

  it("does not execute client hooks for listen requests", async () => {
    const client = vi.fn();
    const { core, request } = await start([
      { name: "client", onRequest: client, onResponse: client, onError: client },
    ]);
    try {
      await request();
      expect(client).not.toHaveBeenCalled();
    } finally {
      await core.destroy();
    }
  });

  it("continues error and settlement hooks despite failures and transforms recovery once", async () => {
    const failure = new Error("handler failed");
    const settled = vi.fn();
    const errors = vi.fn();
    const transform = vi.fn((response: TransportResponse) => ({
      ...response,
      headers: { "x-recovered": "yes" },
    }));
    const { core, request } = await start(
      [
        { name: "recover", onServerError: () => recovered },
        {
          name: "diagnostic",
          onServerError() {
            throw new Error("diagnostic");
          },
          onServerSettled() {
            throw new Error("cleanup");
          },
        },
        {
          name: "observe",
          onServerError: errors,
          onServerResponse: transform,
          onServerSettled: settled,
        },
      ],
      () => {
        throw failure;
      },
    );
    try {
      const response = await request();
      expect(response.headers["x-recovered"]).toBe("yes");
      expect(errors.mock.calls[0]?.[0]).toBe(failure);
      expect(transform).toHaveBeenCalledOnce();
      expect(settled).toHaveBeenCalledOnce();
      expect(settled.mock.calls[0]?.[0]).toEqual({ ok: true, response });
    } finally {
      await core.destroy();
    }
  });

  it("preserves original failures and settles once without recovery", async () => {
    const failure = new Error("incoming failed");
    const settled = vi.fn();
    const { core, request } = await start([
      {
        name: "fail",
        onServerRequest() {
          throw failure;
        },
        onServerError() {
          throw new Error("secondary");
        },
      },
      { name: "cleanup", onServerSettled: settled },
    ]);
    try {
      await expect(request()).rejects.toBe(failure);
      expect(settled).toHaveBeenCalledExactlyOnceWith(
        { ok: false, error: failure },
        raw,
        expect.anything(),
        expect.anything(),
      );
    } finally {
      await core.destroy();
    }
  });

  it("does not repeat outgoing hooks when an outgoing failure is recovered", async () => {
    const transform = vi.fn(() => {
      throw new Error("outgoing");
    });
    const settled = vi.fn();
    const { core, request } = await start([
      {
        name: "outgoing",
        onServerResponse: transform,
        onServerError: () => recovered,
        onServerSettled: settled,
      },
    ]);
    try {
      expect(await request()).toBe(recovered);
      expect(transform).toHaveBeenCalledOnce();
      expect(settled).toHaveBeenCalledOnce();
    } finally {
      await core.destroy();
    }
  });

  it("reports recovered-response failure without another recovery cycle", async () => {
    const error = new Error("response");
    const errors = vi.fn(() => recovered);
    const settled = vi.fn();
    const { core, request } = await start(
      [
        {
          name: "recover",
          onServerError: errors,
          onServerResponse() {
            throw error;
          },
          onServerSettled: settled,
        },
      ],
      () => {
        throw new Error("handler");
      },
    );
    try {
      await expect(request()).rejects.toBe(error);
      expect(errors).toHaveBeenCalledTimes(2);
      expect(settled).toHaveBeenCalledOnce();
      expect(settled.mock.calls[0]?.[0]).toEqual({ ok: false, error });
    } finally {
      await core.destroy();
    }
  });

  it("uses one plugin snapshot per incoming request", async () => {
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const late = vi.fn();
    const { core, request } = await start([
      {
        name: "pause",
        async onServerRequest() {
          entered();
          await paused;
        },
      },
    ]);
    try {
      const first = request();
      await started;
      core.use({ name: "late", onServerResponse: late });
      resume();
      await first;
      expect(late).not.toHaveBeenCalled();
      await request();
      expect(late).toHaveBeenCalledOnce();
    } finally {
      resume();
      await core.destroy();
    }
  });
});
