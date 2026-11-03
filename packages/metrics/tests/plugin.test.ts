import type {
  IHyperCore,
  PluginContext,
  RequestContext,
  RequestOutcome,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { describe, expect, it, vi } from "vitest";
import { withMetrics } from "../src/index.js";
import type { CollectedRequestMetrics, MetricsOptions } from "../src/index.js";

function requestContext(): RequestContext {
  return {
    requestId: "request-1",
    startTime: Date.now(),
    meta: {},
    state: {},
  };
}

function setup(options?: Partial<MetricsOptions>) {
  const core = {} as IHyperCore;
  const plugin = withMetrics(options);
  plugin.setup?.({ config: { metrics: { enabled: true } }, core } as PluginContext);
  return { core, plugin };
}

async function collect(
  request: SendRequest,
  response: UniversalResponse,
  options?: Partial<MetricsOptions>,
): Promise<CollectedRequestMetrics> {
  const { core, plugin } = setup(options);
  const context = requestContext();
  await plugin.onRequest?.(request, undefined, context);
  await plugin.onResponse?.(response, request, undefined, context);
  return core.getAllMetrics?.()[0] as CollectedRequestMetrics;
}

describe("withMetrics", () => {
  it("keeps REST method, URL, status and content-length defaults", async () => {
    const metric = await collect(
      {
        protocol: "rest",
        input: {
          method: "POST",
          url: "https://example.test/widgets",
          headers: { "Content-Length": "12" },
          body: "ignored because the header wins",
        },
      },
      {
        protocol: "rest",
        ok: true,
        status: 201,
        headers: { "content-length": "7" },
        data: "ignored",
        metadata: { fromCache: true },
      },
    );

    expect(metric).toMatchObject({
      protocol: "rest",
      operationKey: "POST https://example.test/widgets",
      requestLabels: {
        method: "POST",
        url: "https://example.test/widgets",
      },
      method: "POST",
      url: "https://example.test/widgets",
      outcome: "success",
      status: 201,
      statusCode: 201,
      bytesSent: 12,
      bytesReceived: 7,
      cached: true,
    });
  });

  it.each([
    [
      "https://synthetic-user:synthetic-password@example.test/widgets?token=synthetic-query#synthetic-fragment",
      "https://example.test/widgets",
    ],
    [
      "https://example.test/widgets?token=synthetic-query#synthetic-fragment",
      "https://example.test/widgets",
    ],
    [
      "//synthetic-user:synthetic-password@example.test/widgets?token=synthetic-query#synthetic-fragment",
      "https://example.test/widgets",
    ],
    ["/widgets?token=synthetic-query#synthetic-fragment", "/widgets"],
    ["widgets?token=synthetic-query#synthetic-fragment", "/widgets"],
    ["../widgets?token=synthetic-query#synthetic-fragment", "/widgets"],
    ["?token=synthetic-query#synthetic-fragment", "/"],
    ["#synthetic-fragment", "/"],
    [
      "https://synthetic-user:synthetic-password@[invalid/widgets?token=synthetic-query#synthetic-fragment",
      undefined,
    ],
    ["data:synthetic-password?token=synthetic-query#synthetic-fragment", undefined],
    ["file:///synthetic-password?token=synthetic-query#synthetic-fragment", undefined],
    [
      "blob:https://example.test/synthetic-password?token=synthetic-query#synthetic-fragment",
      undefined,
    ],
  ])("sanitizes default URL metrics for %s", async (url, expectedUrl) => {
    const request: SendRequest = { protocol: "rest", input: { method: "GET", url } };
    const metric = await collect(request, {
      protocol: "rest",
      ok: true,
      status: 200,
      headers: {},
      data: "",
    });

    expect(metric.url).toBe(expectedUrl);
    expect(metric.requestLabels).toEqual(
      expectedUrl ? { method: "GET", url: expectedUrl } : { method: "GET" },
    );
    expect(metric.operationKey).toBe(expectedUrl ? `GET ${expectedUrl}` : "GET");
    const serialized = JSON.stringify(metric);
    for (const secret of [
      "synthetic-user",
      "synthetic-password",
      "synthetic-query",
      "synthetic-fragment",
      "?",
      "#",
      "@",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect((request.input as { url: string }).url).toBe(url);
  });

  it("sanitizes operation keys without a method", async () => {
    const metric = await collect(
      {
        protocol: "rest",
        input: {
          url: "https://synthetic-user:synthetic-password@example.test/widgets?token=synthetic-query#synthetic-fragment",
        },
      },
      { protocol: "rest", ok: true, status: 200, headers: {}, data: "" },
    );
    expect(metric.operationKey).toBe("https://example.test/widgets");
    expect(metric.requestLabels).toEqual({ url: "https://example.test/widgets" });
    expect(metric.url).toBe("https://example.test/widgets");
  });

  it("sanitizes default metrics on the error path", async () => {
    const { core, plugin } = setup();
    const context = requestContext();
    const request: SendRequest = {
      protocol: "rest",
      input: {
        method: "GET",
        url: "https://synthetic-user:synthetic-password@example.test/widgets?token=synthetic-query#synthetic-fragment",
      },
    };
    await plugin.onRequest?.(request, undefined, context);
    await plugin.onError?.(new Error("request failed"), request, undefined, context);
    expect(core.getAllMetrics?.()[0]).toMatchObject({
      operationKey: "GET https://example.test/widgets",
      requestLabels: { method: "GET", url: "https://example.test/widgets" },
      url: "https://example.test/widgets",
      outcome: "failure",
    });
  });

  it("keeps explicit custom URL labels and operation keys unchanged", async () => {
    const url =
      "https://synthetic-user:synthetic-password@example.test/widgets?token=synthetic-query#synthetic-fragment";
    const metric = await collect(
      { protocol: "rest", input: { method: "GET", url } },
      { protocol: "rest", ok: true, status: 200, headers: {}, data: "" },
      {
        extractors: {
          requestLabels: () => ({ url, custom: true }),
          operationKey: () => `custom:${url}`,
        },
      },
    );
    expect(metric.requestLabels).toEqual({ url, custom: true });
    expect(metric.url).toBe(url);
    expect(metric.operationKey).toBe(`custom:${url}`);
  });

  it("does not fall back to defaults when custom extractors return undefined", async () => {
    const metric = await collect(
      {
        protocol: "rest",
        input: { method: "GET", url: "https://example.test/widgets?token=synthetic-query" },
      },
      { protocol: "rest", ok: true, status: 200, headers: {}, data: "" },
      { extractors: { requestLabels: () => undefined, operationKey: () => undefined } },
    );
    expect(metric.requestLabels).toBeUndefined();
    expect(metric.url).toBeUndefined();
    expect(metric.operationKey).toBeUndefined();
  });

  it("uses extractors for a custom protocol without assuming HTTP fields", async () => {
    const metric = await collect(
      {
        protocol: "queue",
        input: { topic: "invoices", payload: new Uint8Array([1, 2, 3]) },
        metadata: { attempt: 2 },
      },
      {
        protocol: "queue",
        ok: true,
        status: 0,
        headers: {},
        data: { acknowledgement: "ack-42", size: 5 },
        metadata: { storage: "local" },
      },
      {
        extractors: {
          operationKey: ({ request }) => `publish:${(request.input as { topic: string }).topic}`,
          requestLabels: ({ request }) => ({
            topic: (request.input as { topic: string }).topic,
            attempt: Number(request.metadata?.attempt),
          }),
          outcome: ({ response }) =>
            (response?.data as { acknowledgement?: string }).acknowledgement
              ? "success"
              : "failure",
          status: ({ response }) => (response?.data as { acknowledgement: string }).acknowledgement,
          bytesSent: ({ request }) => (request.input as { payload: Uint8Array }).payload.byteLength,
          bytesReceived: ({ response }) => (response?.data as { size: number }).size,
          cached: ({ response }) => response?.metadata?.storage === "local",
        },
      },
    );

    expect(metric).toMatchObject({
      protocol: "queue",
      operationKey: "publish:invoices",
      requestLabels: { topic: "invoices", attempt: 2 },
      outcome: "success",
      status: "ack-42",
      bytesSent: 3,
      bytesReceived: 5,
      cached: true,
    });
    expect(metric.method).toBeUndefined();
    expect(metric.url).toBeUndefined();
    expect(metric.statusCode).toBeUndefined();
  });
});

describe("Core3 settlement", () => {
  it.each(["recovery", "transformation", "rejection", "non-ok"] as const)(
    "records the final %s once, including post-hook time and metadata",
    async (scenario) => {
      const clock = vi.spyOn(performance, "now").mockReturnValue(100);
      try {
        const { core, plugin } = setup();
        const callbacks: ((outcome: RequestOutcome) => void | Promise<void>)[] = [];
        const context: RequestContext = {
          ...requestContext(),
          onSettled: (callback) => {
            callbacks.push(callback);
          },
        };
        const request: SendRequest = { protocol: "rest", input: { method: "GET", url: "/items" } };
        const preliminary: UniversalResponse = {
          protocol: "rest",
          ok: true,
          status: 200,
          headers: {},
          data: "early",
        };
        await plugin.onRequest?.(request, undefined, context);
        if (scenario === "recovery")
          await plugin.onError?.(new Error("transient"), request, undefined, context);
        await plugin.onResponse?.(preliminary, request, undefined, context);
        if (scenario === "rejection")
          await plugin.onError?.(new Error("late failure"), request, undefined, context);
        expect(core.getAllMetrics?.()).toEqual([]);
        context.meta.retryCount = 2;
        clock.mockReturnValue(175);
        const final: UniversalResponse = {
          ...preliminary,
          ok: scenario !== "non-ok",
          status: scenario === "non-ok" ? 403 : 201,
          headers: { "content-length": "9" },
          data: "final",
        };
        const outcome: RequestOutcome =
          scenario === "rejection"
            ? { ok: false, error: { status: 502 } }
            : { ok: true, response: final };
        for (const callback of callbacks) await callback(outcome);
        // Even an accidentally repeated callback cannot double-count timing state.
        for (const callback of callbacks) await callback(outcome);
        expect(core.getAllMetrics?.()).toHaveLength(1);
        expect(core.getAllMetrics?.()[0]).toMatchObject({
          outcome: scenario === "rejection" || scenario === "non-ok" ? "failure" : "success",
          status: scenario === "rejection" ? 502 : final.status,
          bytesReceived: scenario === "rejection" ? 0 : 9,
          retries: 2,
          duration: 75,
        });
      } finally {
        clock.mockRestore();
      }
    },
  );
});
