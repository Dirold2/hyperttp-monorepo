import { describe, expect, it, vi } from "vitest";
import { applyTimeout, createTimeoutSignal } from "../src/utils/abort.js";
import { deepMerge } from "../src/utils/merge.js";
import { HyperClientError, TimeoutError } from "../src/utils/errors.js";

describe("error guards", () => {
  it("recognizes native instances including custom HyperClientError codes", () => {
    expect(HyperClientError.isHyperClientError(new HyperClientError("custom", "CUSTOM"))).toBe(
      true,
    );
    const timeout = new TimeoutError("/local", 10);
    expect(TimeoutError.isTimeoutError(timeout)).toBe(true);
    expect(HyperClientError.isHyperClientError(timeout)).toBe(true);
  });

  it("recognizes coded Error objects from other bundles", () => {
    expect(
      HyperClientError.isHyperClientError(
        Object.assign(new Error("external"), { code: "HYPER_ERROR" }),
      ),
    ).toBe(true);
    expect(
      TimeoutError.isTimeoutError(Object.assign(new Error("external"), { code: "TIMEOUT" })),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    "TIMEOUT",
    {},
    { code: "TIMEOUT" },
    { code: "HYPER_ERROR" },
    new Error("plain"),
    Object.assign(new Error("wrong"), { code: 42 }),
  ])("rejects non-errors and unmatched codes: %j", (value) => {
    expect(HyperClientError.isHyperClientError(value)).toBe(false);
    expect(TimeoutError.isTimeoutError(value)).toBe(false);
  });
});

describe("deepMerge", () => {
  it("recursively merges objects without mutating or sharing nested source objects", () => {
    const target = { config: { retries: 1, headers: { accept: "application/json" } }, keep: true };
    const source = {
      config: { headers: { authorization: "Bearer token" }, timeout: 500 },
      added: "yes",
    };

    const result = deepMerge(target, source);

    expect(result).toEqual({
      config: {
        retries: 1,
        headers: { accept: "application/json", authorization: "Bearer token" },
        timeout: 500,
      },
      keep: true,
      added: "yes",
    });
    expect(result).not.toBe(target);
    expect(result.config).not.toBe(target.config);
    expect(result.config).not.toBe(source.config);
    expect(result.config.headers).not.toBe(source.config.headers);
    expect(target).toEqual({
      config: { retries: 1, headers: { accept: "application/json" } },
      keep: true,
    });
  });

  it("ignores undefined and prototype-pollution keys while retaining arrays and primitive overrides", () => {
    const source = JSON.parse(
      '{"value":"new","untouched":null,"items":["new"],"__proto__":{"polluted":true}}',
    ) as Record<string, unknown>;
    source.skip = undefined;

    const result = deepMerge(
      { value: "old", skip: "keep", items: ["old"], nested: { present: true } },
      source,
    );

    expect(result).toEqual({
      value: "new",
      skip: "keep",
      items: ["new"],
      nested: { present: true },
      untouched: null,
    });
    expect({}).not.toHaveProperty("polluted");
  });
});

describe("abort timeout utilities", () => {
  it("returns the original signal when a timeout is absent or non-positive", () => {
    const controller = new AbortController();
    const meta: { cleanupSignal?: () => void } = {};

    expect(applyTimeout(controller.signal, undefined, meta)).toBe(controller.signal);
    expect(applyTimeout(controller.signal, 0, meta)).toBe(controller.signal);
    expect(applyTimeout(controller.signal, -1, meta)).toBe(controller.signal);
    expect(meta.cleanupSignal).toBeUndefined();
  });

  it("aborts with a timeout reason and exposes an idempotent cleanup callback", () => {
    vi.useFakeTimers();
    const meta: { cleanupSignal?: () => void } = {};
    const reasonFactory = vi.fn(() => new Error("deadline exceeded"));
    const signal = createTimeoutSignal(undefined, 50, meta, reasonFactory);

    vi.advanceTimersByTime(50);

    expect(signal.aborted).toBe(true);
    expect((signal as AbortSignal & { isTimeout?: boolean }).isTimeout).toBe(true);
    expect(signal.reason).toEqual(new Error("deadline exceeded"));
    expect(reasonFactory).toHaveBeenCalledOnce();
    meta.cleanupSignal?.();
    meta.cleanupSignal?.();
    vi.useRealTimers();
  });

  it("propagates an external abort and cancels its pending timeout", () => {
    vi.useFakeTimers();
    const user = new AbortController();
    const meta: { cleanupSignal?: () => void } = {};
    const signal = createTimeoutSignal(user.signal, 50, meta);
    const reason = new Error("cancelled");

    user.abort(reason);
    vi.advanceTimersByTime(50);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
    expect((signal as AbortSignal & { isTimeout?: boolean }).isTimeout).toBeUndefined();
    vi.useRealTimers();
  });

  it("immediately adopts an already-aborted external signal", () => {
    const user = new AbortController();
    user.abort("already cancelled");
    const meta: { cleanupSignal?: () => void } = {};

    const signal = createTimeoutSignal(user.signal, 1_000, meta);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("already cancelled");
    meta.cleanupSignal?.();
  });
});
