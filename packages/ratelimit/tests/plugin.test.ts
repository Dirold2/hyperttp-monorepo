import type {
  PluginContext,
  RequestContext,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter, withRateLimit } from "../src/index.js";
import type { RateLimitOptions } from "../src/index.js";

function setup(options: Partial<RateLimitOptions> = {}) {
  const plugin = withRateLimit(options);
  const context = {
    config: { rateLimit: { enabled: true, maxRequests: 10, windowMs: 60_000 } },
    core: {},
  } as unknown as PluginContext;
  plugin.setup?.(context);
  return { plugin, context };
}

const request: SendRequest = { protocol: "rpc", input: { operation: "read" } };
const requestContext: RequestContext = {
  requestId: "test",
  startTime: 0,
  meta: {},
  state: {},
};

function response(overrides: Partial<UniversalResponse> = {}): UniversalResponse {
  return {
    protocol: "rest",
    ok: false,
    status: 429,
    headers: {},
    data: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("protocol-neutral rate-limit callbacks", () => {
  it("uses a request token weight callback", async () => {
    const getRequestWeight = vi.fn(() => 3);
    const wait = vi.spyOn(RateLimiter.prototype, "wait");
    const { plugin } = setup({ getRequestWeight });

    await plugin.onRequest?.(request, undefined, requestContext);

    expect(getRequestWeight).toHaveBeenCalledWith(request, requestContext);
    expect(wait).toHaveBeenCalledWith(3, undefined);
  });

  it("lets custom protocols decide response and error penalties", async () => {
    const getResponsePenalty = vi.fn(() => 750);
    const getErrorPenalty = vi.fn(() => 1250);
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup({ getResponsePenalty, getErrorPenalty });
    const customResponse = response({ protocol: "rpc", status: 7 });
    const error = new Error("busy");

    await plugin.onResponse?.(customResponse, request, undefined, requestContext);
    await plugin.onError?.(error, request, undefined, requestContext);

    expect(getResponsePenalty).toHaveBeenCalledWith(customResponse, request, requestContext);
    expect(getErrorPenalty).toHaveBeenCalledWith(error, request, requestContext);
    expect(penalize).toHaveBeenNthCalledWith(1, 750);
    expect(penalize).toHaveBeenNthCalledWith(2, 1250);
  });

  it("allows a custom decision callback to suppress the REST default", async () => {
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup({ getResponsePenalty: () => false });

    await plugin.onResponse?.(response({ headers: { "retry-after": "9" } }));

    expect(penalize).not.toHaveBeenCalled();
  });
});

describe("Retry-After parsing", () => {
  it.each([
    [undefined, 2000],
    ["", 2000],
    ["   ", 2000],
    ["0", 0],
    ["003", 3000],
    [" 3 ", 3000],
    [["4", "9"], 4000],
    [[], 2000],
    ["-1", 2000],
    ["+3", 2000],
    ["1.5", 2000],
    ["3seconds", 2000],
    ["1e3", 2000],
    ["0x10", 2000],
    ["Infinity", 2000],
    ["9".repeat(400), 2000],
    ["2026-11-02T12:00:03Z", 2000],
    ["not a date", 2000],
    ["Mon, 02 Nov 2026 12:00:03 GMT", 3000],
    ["Monday, 02-Nov-26 12:00:03 GMT", 3000],
    ["Mon Nov  2 12:00:03 2026", 3000],
    ["Mon, 02 Nov 2026 11:59:59 GMT", 0],
    ["Mon, 02 Nov 2026 12:00:00 GMT", 0],
    ["Mon, 02 Nov 2026 25:00:00 GMT", 2000],
    ["Mon, 31 Feb 2026 12:00:03 GMT", 2000],
  ] as const)("parses %j as %i milliseconds for responses and errors", async (header, expected) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 10, 2, 12));
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup();
    const res = response({
      headers:
        header === undefined
          ? {}
          : { "rEtRy-AfTeR": typeof header === "string" ? header : [...header] },
    });

    await plugin.onResponse?.(res);
    await plugin.onError?.({ response: res });

    expect(penalize).toHaveBeenCalledTimes(2);
    expect(penalize).toHaveBeenNthCalledWith(1, expected);
    expect(penalize).toHaveBeenNthCalledWith(2, expected);
  });
});

function clientContext(rateLimit: RateLimitOptions = {}): PluginContext {
  return {
    config: { rateLimit },
    core: { getStats: vi.fn(() => ({ marker: "original" })) },
  } as unknown as PluginContext;
}

describe("client-local plugin state", () => {
  it("isolates callbacks, limiters and statistics and retains the last setup fallback", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    const plugin = withRateLimit();
    const firstWeight = vi.fn(() => 2);
    const secondWeight = vi.fn(() => 5);
    const firstResponse = vi.fn(() => 100);
    const secondResponse = vi.fn(() => 200);
    const firstError = vi.fn(() => 300);
    const secondError = vi.fn(() => 400);
    const first = clientContext({
      maxRequests: 10,
      getRequestWeight: firstWeight,
      getResponsePenalty: firstResponse,
      getErrorPenalty: firstError,
    });
    const second = clientContext({
      maxRequests: 20,
      getRequestWeight: secondWeight,
      getResponsePenalty: secondResponse,
      getErrorPenalty: secondError,
    });
    plugin.setup?.(first);
    plugin.setup?.(second);
    expect(first.rateLimiter).not.toBe(second.rateLimiter);
    const firstWait = vi.spyOn(first.rateLimiter!, "wait");
    const secondWait = vi.spyOn(second.rateLimiter!, "wait");
    const firstPenalty = vi.spyOn(first.rateLimiter!, "penalize");
    const secondPenalty = vi.spyOn(second.rateLimiter!, "penalize");

    await plugin.onRequest?.(request, first, requestContext);
    await plugin.onRequest?.(request, second, requestContext);
    await plugin.onRequest?.(request, undefined, requestContext);

    expect(firstWeight).toHaveBeenCalledExactlyOnceWith(request, requestContext);
    expect(secondWeight).toHaveBeenCalledTimes(2);
    expect(firstWait).toHaveBeenCalledExactlyOnceWith(2, undefined);
    expect(secondWait).toHaveBeenCalledTimes(2);
    const stats = (ctx: PluginContext) =>
      (ctx.core as unknown as { getStats(): Record<string, unknown> }).getStats();
    expect(stats(first)).toEqual({ marker: "original", currentRateLimit: 2 });
    expect(stats(second)).toEqual({ marker: "original", currentRateLimit: 10 });

    const res = response();
    const error = new Error("busy");
    await plugin.onResponse?.(res, request, first, requestContext);
    await plugin.onResponse?.(res, request, second, requestContext);
    await plugin.onError?.(error, request, first, requestContext);
    await plugin.onError?.(error, request, second, requestContext);
    await plugin.onResponse?.(res);
    await plugin.onError?.(error);

    expect(firstResponse).toHaveBeenCalledExactlyOnceWith(res, request, requestContext);
    expect(firstError).toHaveBeenCalledExactlyOnceWith(error, request, requestContext);
    expect(secondResponse).toHaveBeenCalledTimes(2);
    expect(secondError).toHaveBeenCalledTimes(2);
    expect(firstPenalty.mock.calls).toEqual([[100], [300]]);
    expect(secondPenalty.mock.calls).toEqual([[200], [400], [200], [400]]);
  });

  it("does not use the fallback for an unknown explicit context", async () => {
    const { plugin } = setup();
    const unknown = clientContext();
    await expect(plugin.onRequest?.(request, unknown)).rejects.toThrow("set up");
    await expect(plugin.onResponse?.(response(), request, unknown)).rejects.toThrow("set up");
    await expect(plugin.onError?.({}, request, unknown)).rejects.toThrow("set up");
  });

  it("keeps the original state while awaiting an asynchronous callback", async () => {
    let resolveWeight!: (weight: number) => void;
    const plugin = withRateLimit();
    const first = clientContext({
      getRequestWeight: () =>
        new Promise<number>((resolve) => {
          resolveWeight = resolve;
        }),
    });
    plugin.setup?.(first);
    const firstWait = vi.spyOn(first.rateLimiter!, "wait");
    const pending = plugin.onRequest?.(request, first);
    const second = clientContext();
    plugin.setup?.(second);
    const secondWait = vi.spyOn(second.rateLimiter!, "wait");
    resolveWeight(2);
    await pending;
    expect(firstWait).toHaveBeenCalledWith(2, undefined);
    expect(secondWait).not.toHaveBeenCalled();
  });
});

describe("enabled precedence", () => {
  it.each([
    [undefined, undefined, false, true],
    [undefined, false, false, false],
    [undefined, true, true, true],
    [false, undefined, false, false],
    [false, true, false, false],
    [true, false, true, true],
    [true, undefined, true, true],
  ])("options=%s config=%s", async (optionEnabled, configEnabled, active, manualActive) => {
    const getRequestWeight = vi.fn(() => 2);
    const getResponsePenalty = vi.fn(() => 100);
    const getErrorPenalty = vi.fn(() => 200);
    const plugin = withRateLimit({
      enabled: optionEnabled,
      getRequestWeight,
      getResponsePenalty,
      getErrorPenalty,
    });
    const context = clientContext({ enabled: configEnabled });
    expect(plugin.enabled?.(context.config)).toBe(active);
    plugin.setup?.(context);
    await plugin.onRequest?.(request, context);
    expect(context.rateLimiter!.currentCount).toBe(manualActive ? 2 : 0);
    await plugin.onResponse?.(response(), request, context);
    await plugin.onError?.({}, request, context);
    expect(getRequestWeight).toHaveBeenCalledTimes(manualActive ? 1 : 0);
    expect(getResponsePenalty).toHaveBeenCalledTimes(manualActive ? 1 : 0);
    expect(getErrorPenalty).toHaveBeenCalledTimes(manualActive ? 1 : 0);
  });
});

describe("REST defaults", () => {
  it("penalizes HTTP 429 responses using Retry-After", async () => {
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup();

    await plugin.onResponse?.(response({ headers: { "Retry-After": "3" } }));

    expect(penalize).toHaveBeenCalledWith(3000);
  });

  it("uses the two-second fallback for HTTP 429 errors", async () => {
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup();
    const restResponse = response();

    await plugin.onError?.({ status: 429, response: restResponse });

    expect(penalize).toHaveBeenCalledWith(2000);
  });

  it("does not apply the HTTP default to a custom protocol status", async () => {
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup();

    await plugin.onResponse?.(response({ protocol: "rpc", status: 429 }));

    expect(penalize).not.toHaveBeenCalled();
  });
});
