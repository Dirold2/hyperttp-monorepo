import { describe, expect, it, vi } from "vitest";
import type {
  HyperClientOptions,
  PluginContext,
  RequestContext,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { QueueManager, withQueue } from "../src/index.js";

const response: UniversalResponse = {
  protocol: "jobs",
  ok: true,
  status: 1,
  headers: {},
  data: "done",
};

function request(partition = "a", signal?: AbortSignal): SendRequest {
  return { protocol: "jobs", input: { partition }, signal };
}

function requestContext(id: string, signal?: AbortSignal): RequestContext {
  return { requestId: id, startTime: 1, signal, meta: {}, state: {} };
}

function pluginContext(config: HyperClientOptions): PluginContext {
  return { config, core: {} } as PluginContext;
}

describe("QueueManager", () => {
  it.each([NaN, Infinity, -Infinity])("rejects non-finite limit %s", (limit) => {
    expect(() => new QueueManager(limit)).toThrow(RangeError);
  });

  it.each([0, -10, 1.9])("normalizes finite limit %s to one slot", async (limit) => {
    const queue = new QueueManager(limit);
    const release = await queue.acquire();
    const waiting = queue.acquire();
    expect(queue.activeCount).toBe(1);
    expect(queue.queuedCount).toBe(1);
    release();
    (await waiting)();
    expect(queue.activeCount).toBe(0);
  });
  it("releases queued work in FIFO order and release is idempotent", async () => {
    const queue = new QueueManager(1);
    const firstRelease = await queue.acquire();
    const second = queue.acquire();
    expect(queue.activeCount).toBe(1);
    expect(queue.queuedCount).toBe(1);

    firstRelease();
    const secondRelease = await second;
    firstRelease();
    expect(queue.activeCount).toBe(1);
    secondRelease();
    expect(queue.activeCount).toBe(0);
  });

  it("rejects and removes an aborted waiter", async () => {
    const queue = new QueueManager(1);
    const release = await queue.acquire();
    const controller = new AbortController();
    const waiting = queue.acquire(controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(queue.queuedCount).toBe(0);
    release();
  });
});

describe("withQueue", () => {
  it("preserves explicit activation and configuration precedence", () => {
    expect(withQueue().enabled?.({})).toBe(false);
    expect(withQueue().enabled?.({ queue: { maxConcurrent: 1 } })).toBe(false);
    expect(withQueue().enabled?.({ queue: { enabled: true } })).toBe(true);
    expect(withQueue({}).enabled?.({})).toBe(true);
    expect(withQueue({ enabled: false }).enabled?.({})).toBe(false);
    expect(withQueue({ enabled: true }).enabled?.({ queue: { enabled: false } })).toBe(false);
    expect(withQueue({ enabled: false }).enabled?.({ queue: { enabled: true } })).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite configuration %s during setup",
    (limit) => {
      expect(() => withQueue({ maxConcurrent: limit }).setup?.(pluginContext({}))).toThrow(
        RangeError,
      );
    },
  );

  it("prefers client concurrency and partition settings over factory options", async () => {
    const factoryPartition = vi.fn(() => "factory");
    const configuredPartition = vi.fn(() => "configured");
    const plugin = withQueue({ maxConcurrent: 2, partitionKey: factoryPartition });
    const context = pluginContext({
      queue: { maxConcurrent: 1, partitionKey: configuredPartition },
    });
    plugin.setup?.(context);
    const first = request();
    const second = request();
    await plugin.onRequest?.(first, context);
    let acquired = false;
    const waiting = Promise.resolve(plugin.onRequest?.(second, context)).then(() => {
      acquired = true;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);
    expect(factoryPartition).not.toHaveBeenCalled();
    expect(configuredPartition).toHaveBeenCalledTimes(2);
    plugin.onResponse?.(response, first, context);
    await waiting;
    plugin.onResponse?.(response, second, context);
  });

  it.each(["request", "context"] as const)(
    "observes the %s signal when both signals exist",
    async (source) => {
      const plugin = withQueue({ maxConcurrent: 1 });
      const context = pluginContext({});
      plugin.setup?.(context);
      const active = request();
      await plugin.onRequest?.(active, context);
      const requestController = new AbortController();
      const contextController = new AbortController();
      const waiting = plugin.onRequest?.(
        request("a", requestController.signal),
        context,
        requestContext("waiting", contextController.signal),
      );
      (source === "request" ? requestController : contextController).abort();
      await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
      plugin.onResponse?.(response, active, context);
    },
  );

  it("rejects a pre-aborted context even when the request has a live signal", async () => {
    const plugin = withQueue({ maxConcurrent: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      plugin.onRequest?.(
        request("a", new AbortController().signal),
        pluginContext({}),
        requestContext("aborted", controller.signal),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retains busy partitions and removes idle ones after completion and cancellation", async () => {
    const acquire = vi.spyOn(QueueManager.prototype, "acquire");
    try {
      const plugin = withQueue({ maxConcurrent: 1 });
      const context = pluginContext({});
      plugin.setup?.(context);
      const first = request();
      const controller = new AbortController();
      await plugin.onRequest?.(first, context);
      const waiting = plugin.onRequest?.(request("a", controller.signal), context);
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
      const second = request();
      const blocked = plugin.onRequest?.(second, context);
      expect(acquire.mock.contexts[2]).toBe(acquire.mock.contexts[0]);
      plugin.onResponse?.(response, first, context);
      await blocked;
      plugin.onError?.(new Error("network"), second, context);
      const third = request();
      await plugin.onRequest?.(third, context);
      expect(acquire.mock.contexts[3]).not.toBe(acquire.mock.contexts[0]);
      plugin.onResponse?.(response, third, context);
    } finally {
      acquire.mockRestore();
    }
  });
  it("uses lifecycle context, maxConcurrent, and custom partitions", async () => {
    const partitionKey = vi.fn(
      (req: SendRequest, context?: RequestContext) =>
        `${(req.input as { partition: string }).partition}:${context?.meta.tenant}`,
    );
    const plugin = withQueue({ maxConcurrent: 1, partitionKey });
    const context = pluginContext({});
    plugin.setup?.(context);

    const reqA1 = request("a");
    const reqA2 = request("a");
    const reqB = request("b");
    const ctxA1 = { ...requestContext("a1"), meta: { tenant: "one" } };
    const ctxA2 = { ...requestContext("a2"), meta: { tenant: "one" } };
    const ctxB = { ...requestContext("b"), meta: { tenant: "one" } };

    await plugin.onRequest?.(reqA1, context, ctxA1);
    const blocked = plugin.onRequest?.(reqA2, context, ctxA2);
    let acquired = false;
    void Promise.resolve(blocked).then(() => {
      acquired = true;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);

    await plugin.onRequest?.(reqB, context, ctxB);
    plugin.onResponse?.(response, reqA1, context, ctxA1);
    await blocked;
    expect(acquired).toBe(true);
    expect(partitionKey).toHaveBeenCalledWith(reqA1, ctxA1);

    plugin.onResponse?.(response, reqA2, context, ctxA2);
    plugin.onResponse?.(response, reqB, context, ctxB);
  });

  it("releases slots on errors", async () => {
    const plugin = withQueue({ maxConcurrent: 1 });
    const context = pluginContext({});
    plugin.setup?.(context);
    const first = request();
    const second = request();
    const firstContext = requestContext("first");
    const secondContext = requestContext("second");

    await plugin.onRequest?.(first, context, firstContext);
    const blocked = plugin.onRequest?.(second, context, secondContext);
    plugin.onError?.(new Error("network"), first, context, firstContext);
    await expect(blocked).resolves.toBeUndefined();
    plugin.onResponse?.(response, second, context, secondContext);
  });

  it("rejects pre-aborted requests and queued aborts", async () => {
    const plugin = withQueue({ maxConcurrent: 1 });
    const context = pluginContext({});
    plugin.setup?.(context);

    const active = request();
    const activeContext = requestContext("active");
    await plugin.onRequest?.(active, context, activeContext);

    const queuedController = new AbortController();
    const queuedContext = requestContext("queued", queuedController.signal);
    const queued = plugin.onRequest?.(request(), context, queuedContext);
    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });

    const abortedController = new AbortController();
    abortedController.abort();
    await expect(
      plugin.onRequest?.(
        request("a", abortedController.signal),
        context,
        requestContext("aborted"),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    plugin.onResponse?.(response, active, context, activeContext);
  });
});

type Outcome = { ok: true; response: UniversalResponse } | { ok: false; error: unknown };

function lifecycleContext(id: string) {
  const callbacks: Array<(outcome: Outcome) => void> = [];
  const ctx = {
    ...requestContext(id),
    onSettled: vi.fn((callback: (outcome: Outcome) => void) => callbacks.push(callback)),
  };
  return { ctx, settle: (outcome: Outcome) => callbacks.forEach((callback) => callback(outcome)) };
}

describe("queue settlement lifecycle", () => {
  it.each(["success", "failure", "abort"])(
    "holds its slot until final %s settlement and releases exactly once",
    async (kind) => {
      const plugin = withQueue({ maxConcurrent: 1 });
      const config = pluginContext({});
      plugin.setup?.(config);
      const first = lifecycleContext("first");
      const second = lifecycleContext("second");
      await plugin.onRequest?.(request(), config, first.ctx);
      let acquired = false;
      const waiting = Promise.resolve(plugin.onRequest?.(request(), config, second.ctx)).then(
        () => {
          acquired = true;
        },
      );
      plugin.onResponse?.(response, request(), config, first.ctx);
      plugin.onError?.(new Error("intermediate"), request(), config, first.ctx);
      await Promise.resolve();
      expect(acquired).toBe(false);
      expect(first.ctx.onSettled).toHaveBeenCalledTimes(1);
      expect(second.ctx.onSettled).not.toHaveBeenCalled();
      const outcome: Outcome =
        kind === "success"
          ? { ok: true, response }
          : {
              ok: false,
              error:
                kind === "abort" ? new DOMException("aborted", "AbortError") : new Error("final"),
            };
      first.settle(outcome);
      await waiting;
      expect(second.ctx.onSettled).toHaveBeenCalledTimes(1);
      first.settle(outcome);
      plugin.onResponse?.(response, request(), config, first.ctx);
      let thirdAcquired = false;
      const third = request();
      const thirdWaiting = Promise.resolve(plugin.onRequest?.(third, config)).then(() => {
        thirdAcquired = true;
      });
      await Promise.resolve();
      expect(thirdAcquired).toBe(false);
      second.settle({ ok: true, response });
      await thirdWaiting;
      plugin.onResponse?.(response, third, config);
    },
  );
});
