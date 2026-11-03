import type {
  HyperClientOptions,
  IHyperCore,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryPlugin, createRetryPlugin, withRetry } from "../src/plugin.js";

const request: SendRequest = { protocol: "rest", input: { method: "GET", url: "/" } };
const response: UniversalResponse = {
  protocol: "rest",
  ok: true,
  status: 200,
  headers: {},
  data: { id: 1 },
};

function createClient(send: ReturnType<typeof vi.fn>, config: HyperClientOptions = {}) {
  return { send, config } as unknown as IHyperCore;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withRetry", () => {
  it("does not retry POST by default", async () => {
    const error = { code: "ECONNRESET" };
    const send = vi.fn().mockRejectedValue(error);
    const client = withRetry(createClient(send), {});
    await expect(
      client.send({ protocol: "rest", input: { method: "POST", url: "/pay" } }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never replays a stream even with an explicit retry predicate", async () => {
    const error = { status: 503 };
    const send = vi.fn().mockRejectedValue(error);
    const client = withRetry(createClient(send), { shouldRetry: () => true });
    await expect(
      client.send({ protocol: "rest", input: { method: "PUT", body: new ReadableStream() } }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries returned 503 responses and respects Retry-After", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ...response,
        status: 503,
        ok: false,
        headers: { "Retry-After": "1" },
      })
      .mockResolvedValue(response);
    const client = withRetry(createClient(send), { baseDelay: 0, jitter: false });
    const result = client.send(request);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(response);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("returns the response rather than shortening an excessive Retry-After", async () => {
    const unavailable = { ...response, status: 429, headers: { "retry-after": "60" } };
    const send = vi.fn().mockResolvedValue(unavailable);
    const client = withRetry(createClient(send), { maxDelay: 1000 });
    await expect(client.send(request)).resolves.toBe(unavailable);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("cancels backoff without sending another attempt", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const send = vi.fn().mockRejectedValue({ code: "ECONNRESET" });
    const client = withRetry(createClient(send), { baseDelay: 1000, jitter: false });
    const rejected = expect(client.send({ ...request, signal: controller.signal })).rejects.toBe(
      reason,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    await rejected;
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not multiply retries when installed twice", async () => {
    vi.useFakeTimers();
    const error = { status: 503 };
    const send = vi.fn().mockRejectedValue(error);
    const client = createClient(send);
    withRetry(client, { maxRetries: 1, baseDelay: 0 });
    const wrapped = client.send;
    withRetry(client, { maxRetries: 10 });
    expect(client.send).toBe(wrapped);
    const rejected = expect(client.send(request)).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await rejected;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not log transport error messages or request URLs", async () => {
    vi.useFakeTimers();
    const logger = vi.fn();
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("synthetic-secret"), { code: "ECONNRESET" }))
      .mockResolvedValue(response);
    const client = withRetry(createClient(send), { baseDelay: 0 }, { verbose: true, logger });
    const result = client.send(request);
    await vi.runAllTimersAsync();
    await result;
    expect(JSON.stringify(logger.mock.calls)).not.toContain("synthetic-secret");
  });

  it("declines retry beyond the elapsed budget", async () => {
    const send = vi.fn().mockResolvedValue({ ...response, status: 503 });
    const client = withRetry(createClient(send), { maxElapsedMs: 0 });
    await client.send(request);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("preserves the client binding, request and universal response", async () => {
    const send = vi.fn(function (this: IHyperCore, req: SendRequest) {
      expect(this).toBe(client);
      expect(req).toBe(request);
      return Promise.resolve(response);
    });
    const client = createClient(send);

    expect(withRetry(client, {})).toBe(client);
    await expect(client.send(request)).resolves.toBe(response);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries with exponential delay capped at maxDelay", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockRejectedValueOnce({ code: "ECONNRESET" })
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValue(response);
    const client = withRetry(createClient(send), {
      baseDelay: 100,
      maxDelay: 150,
      jitter: false,
    });
    const result = client.send(request);

    await vi.advanceTimersByTimeAsync(99);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(150);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(150);
    await expect(result).resolves.toBe(response);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("propagates the original error when retries are exhausted", async () => {
    vi.useFakeTimers();
    const error = { code: "ETIMEDOUT" };
    const send = vi.fn().mockRejectedValue(error);
    const client = withRetry(createClient(send), { maxRetries: 2, baseDelay: 0 });
    const result = expect(client.send(request)).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await result;
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each([null, undefined, "failure", new Error("failure"), { status: 400 }])(
    "does not retry non-retriable errors: %s",
    async (error) => {
      const send = vi.fn().mockRejectedValue(error);
      const client = withRetry(createClient(send), {});
      await expect(client.send(request)).rejects.toBe(error);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry when maxRetries is zero", async () => {
    const error = { status: 503 };
    const send = vi.fn().mockRejectedValue(error);
    const client = withRetry(createClient(send), { maxRetries: 0 });
    await expect(client.send(request)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("RetryPlugin", () => {
  it("is enabled by default and respects retry.enabled", () => {
    expect(RetryPlugin.enabled?.({})).toBe(true);
    expect(RetryPlugin.enabled?.({ retry: { enabled: false } })).toBe(false);
    expect(RetryPlugin.enabled?.({ retry: { enabled: true } })).toBe(true);
  });

  it("installs retries through setup and passes logging configuration", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const logger = vi.fn();
    const config: HyperClientOptions = {
      retry: { baseDelay: 100, maxRetries: 1 },
      verbose: true,
      logger,
    };
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("reset"), { code: "ECONNRESET" }))
      .mockResolvedValue(response);
    const client = createClient(send, config);
    RetryPlugin.setup?.({ core: client, config });
    const result = client.send(request);

    await vi.advanceTimersByTimeAsync(49);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(response);
    expect(logger).toHaveBeenCalledWith("warn", expect.stringContaining("1/1 after 50ms"));
  });
});

 it("creates distinct retry plugin instances with the same compatibility surface", () => {
  const first = createRetryPlugin();
  const second = createRetryPlugin();
  expect(first).not.toBe(second);
  expect(first.name).toBe(RetryPlugin.name);
  expect(first.setup).toBeTypeOf("function");
  expect(first.shared).not.toBe(true);
 });
