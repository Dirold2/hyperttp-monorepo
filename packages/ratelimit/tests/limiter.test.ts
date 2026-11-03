import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/utils/RateLimiter.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

function create(maxRequests = 1, windowMs = 100) {
  return new RateLimiter({ enabled: true, maxRequests, windowMs });
}

describe("queue lifecycle", () => {
  it("rejects an aborted head and allows the next waiter to proceed", async () => {
    const limiter = create();
    limiter.tryConsume();
    const controller = new AbortController();
    const first = expect(limiter.wait(1, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    const next = vi.fn();
    const second = limiter.wait()!.then(next);
    controller.abort();
    await first;
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(next).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("detaches abort listeners on reset before reusing pooled nodes", async () => {
    const limiter = create();
    limiter.tryConsume();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const old = expect(limiter.wait(1, controller.signal)).rejects.toThrow("reset");
    limiter.reset();
    await old;
    expect(remove).toHaveBeenCalledOnce();
    limiter.tryConsume();
    const next = limiter.wait();
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    await expect(next).resolves.toBeUndefined();
  });

  it("cleans up signals after successful waits and aborts in the middle", async () => {
    const limiter = create();
    limiter.tryConsume();
    const firstController = new AbortController();
    const remove = vi.spyOn(firstController.signal, "removeEventListener");
    const first = limiter.wait(1, firstController.signal);
    const controller = new AbortController();
    const cancelled = expect(limiter.wait(1, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    const last = limiter.wait();
    controller.abort();
    await cancelled;
    await vi.advanceTimersByTimeAsync(200);
    await first;
    await last;
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves FIFO order for weighted requests", async () => {
    const limiter = create(3, 300);
    limiter.tryConsume(3);
    const order: number[] = [];
    const first = limiter.wait(3)!.then(() => order.push(1));
    const second = limiter.wait(1)!.then(() => order.push(2));
    await vi.advanceTimersByTimeAsync(200);
    expect(order).toEqual([]);
    expect(limiter.tryConsume()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });
});

describe("penalty locks", () => {
  it("blocks immediate and queued consumption even with refilled tokens", async () => {
    const limiter = create();
    limiter.penalize(1000);
    await vi.advanceTimersByTimeAsync(200);
    expect(limiter.tryConsume()).toBe(false);
    expect(limiter.remainingRequests).toBe(0);
    expect(limiter.timeToReset).toBe(800);
    const done = vi.fn();
    const queued = limiter.wait()!.then(done);
    await vi.advanceTimersByTimeAsync(799);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await queued;
    expect(done).toHaveBeenCalledOnce();
  });

  it("reschedules an existing queue when penalized", async () => {
    const limiter = create();
    limiter.tryConsume();
    const done = vi.fn();
    const queued = limiter.wait()!.then(done);
    limiter.penalize(1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await queued;
  });

  it("does not refill using time elapsed before the penalty", async () => {
    const limiter = create();
    await vi.advanceTimersByTimeAsync(1000);
    limiter.penalize(0);
    expect(limiter.tryConsume()).toBe(false);
    expect(limiter.timeToReset).toBe(100);
  });

  it("never shortens a lock and clears it on reset", async () => {
    const limiter = create();
    limiter.penalize(1000);
    await vi.advanceTimersByTimeAsync(100);
    limiter.penalize(10);
    expect(limiter.timeToReset).toBe(900);
    limiter.reset();
    expect(limiter.timeToReset).toBe(0);
    expect(limiter.tryConsume()).toBe(true);
  });

  it.each([NaN, Infinity, -1])("ignores invalid penalty %s", (duration) => {
    const limiter = create();
    limiter.penalize(duration);
    expect(limiter.tryConsume()).toBe(true);
  });
});

describe("numeric boundaries", () => {
  it("supports windows and timers beyond signed 32-bit integers", async () => {
    const duration = 2_592_000_000;
    const limiter = create(1, duration);
    limiter.tryConsume();
    expect(limiter.timeToReset).toBe(duration);
    const done = vi.fn();
    const queued = limiter.wait()!.then(done);
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(duration - 2_147_483_647);
    await queued;
    expect(done).toHaveBeenCalledOnce();
  });

  it("does not wrap large capacities or weights", () => {
    const limiter = create(3_000_000_000);
    expect(limiter.remainingRequests).toBe(3_000_000_000);
    expect(limiter.tryConsume(2_500_000_000)).toBe(true);
    expect(limiter.remainingRequests).toBe(500_000_000);
  });

  it("uses finite defaults for non-finite configuration", () => {
    const limiter = create(Infinity, NaN);
    expect(limiter.remainingRequests).toBe(100);
    limiter.tryConsume(100);
    expect(limiter.timeToReset).toBe(600);
  });
});
