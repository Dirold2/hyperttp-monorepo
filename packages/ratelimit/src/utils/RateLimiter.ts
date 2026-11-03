import type { RateLimitOptions, WaiterNode } from "../types/limiter.js";

/**
 * @en High-performance token-bucket rate limiter with FIFO queue and object pooling.
 * @ru Высокопроизводительный ограничитель скорости на основе токенов с FIFO-очередью и пулом объектов.
 */
export class RateLimiter {
  private readonly enabled: boolean;
  private readonly max: number;
  private readonly window: number;
  private readonly refillRate: number;

  private tokens: number;
  private lastRefill: number;

  private head: WaiterNode | null = null;
  private tail: WaiterNode | null = null;

  private pool: WaiterNode[] = [];
  private poolSize = 0;
  private readonly maxPoolSize = 10000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lockedUntil = 0;

  constructor(config?: RateLimitOptions) {
    this.enabled = config?.enabled ?? false;

    const maxReq = config?.maxRequests ?? 100;
    const winMs = config?.windowMs ?? 60_000;

    this.max = Number.isFinite(maxReq) ? Math.max(1, Math.floor(maxReq)) : 100;
    this.window = Number.isFinite(winMs) ? Math.max(1, Math.floor(winMs)) : 60_000;

    this.refillRate = this.max / this.window;
    this.tokens = this.max;
    this.lastRefill = Date.now();
  }

  /**
   * @en Waits until enough tokens are available to proceed. Returns a promise if queued, or null if immediate.
   * @ru Ожидает появления достаточного количества токенов для продолжения. Возвращает обещание, если запрос в очереди, или null, если немедленно.
   * @param tokensNeeded - Number of tokens required for this operation.
   * @param signal - Optional abort signal to cancel the wait.
   * @returns A promise resolving when tokens are available, or null if allowed immediately.
   */
  public wait(tokensNeeded = 1, signal?: AbortSignal): Promise<void> | null {
    if (!this.enabled) return null;

    if (signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }

    tokensNeeded = this.normalizeWeight(tokensNeeded);

    this.refill();

    if (Date.now() >= this.lockedUntil && this.head === null && this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded;
      return null;
    }

    return new Promise<void>((resolve, reject) => {
      let node: WaiterNode;

      if (this.poolSize > 0) {
        node = this.pool[--this.poolSize];
        node.tokensNeeded = tokensNeeded;
        node.resolve = resolve;
        node.reject = reject;
        node.next = null;
        node.cancelled = false;
      } else {
        node = { tokensNeeded, resolve, reject, next: null, cancelled: false };
      }

      if (signal) {
        const onAbort = () => {
          node.cancelled = true;
          node.reject?.(new DOMException("The user aborted a request.", "AbortError"));
          node.cleanup?.();
          node.cleanup = null;
          node.resolve = null;
          node.reject = null;

          if (this.head === node) {
            this.clearTimer();
            this.scheduleDrain();
          }
        };

        signal.addEventListener("abort", onAbort, { once: true });

        node.cleanup = () => signal.removeEventListener("abort", onAbort);
      }

      if (this.tail !== null) {
        this.tail.next = node;
      } else {
        this.head = node;
      }
      this.tail = node;

      this.scheduleDrain();
    });
  }

  /**
   * @en Attempts to consume tokens immediately without waiting.
   * @ru Пытается немедленно потребить токены без ожидания.
   * @param tokensNeeded - Number of tokens to consume.
   * @returns True if tokens were consumed successfully, false otherwise.
   */
  public tryConsume(tokensNeeded = 1): boolean {
    if (!this.enabled) return true;

    tokensNeeded = this.normalizeWeight(tokensNeeded);

    this.refill();

    if (Date.now() >= this.lockedUntil && this.head === null && this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded;
      return true;
    }

    return false;
  }

  private normalizeWeight(value: number): number {
    if (Number.isNaN(value)) return 1;
    return Math.min(this.max, Math.max(1, Math.floor(value)));
  }

  /**
   * @en Refills tokens based on elapsed time since last refill.
   * @ru Пополняет токены на основе времени, прошедшего с последнего пополнения.
   * @private
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;

    if (elapsedMs > 0) {
      this.tokens += elapsedMs * this.refillRate;
      if (this.tokens > this.max) this.tokens = this.max;
      this.lastRefill = now;
    }
  }

  /**
   * @en Processes the FIFO queue, resolving promises for requests that can now proceed.
   * @ru Обрабатывает FIFO-очередь, разрешая обещания для запросов, которые теперь могут выполниться.
   * @private
   */
  private drainQueue(): void {
    this.timer = null;
    this.refill();

    while (this.head !== null) {
      const next = this.head;

      if (next.cancelled) {
        this.head = next.next;
        if (this.head === null) this.tail = null;
        this.releaseNode(next);
        continue;
      }

      if (Date.now() < this.lockedUntil || this.tokens < next.tokensNeeded) {
        break;
      }

      this.tokens -= next.tokensNeeded;
      this.head = next.next;
      if (this.head === null) this.tail = null;

      if (next.resolve) next.resolve();
      this.releaseNode(next);
    }

    if (this.head !== null) {
      this.scheduleDrain();
    }
  }

  /**
   * @en Returns a waiter node to the object pool for reuse.
   * @ru Возвращает узел ожидания в пул объектов для повторного использования.
   * @param node - The node to release.
   * @private
   */
  private releaseNode(node: WaiterNode): void {
    node.cleanup?.();
    node.cleanup = null;
    node.resolve = null;
    node.reject = null;
    node.next = null;

    if (this.poolSize < this.maxPoolSize) {
      this.pool[this.poolSize++] = node;
    }
  }

  /**
   * @en Clears the scheduled drain timer.
   * @ru Очищает запланированный таймер обработки очереди.
   * @private
   */
  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * @en Schedules the next queue drain execution based on token availability.
   * @ru Планирует следующее выполнение обработки очереди на основе доступности токенов.
   * @private
   */
  private scheduleDrain(): void {
    if (this.timer !== null) return;

    while (this.head !== null && this.head.cancelled) {
      const next = this.head;
      this.head = next.next;
      if (this.head === null) this.tail = null;
      this.releaseNode(next);
    }

    if (this.head === null) return;

    this.refill();
    const needed = this.head.tokensNeeded - this.tokens;
    const waitMs = Math.ceil(Math.max(needed / this.refillRate, this.lockedUntil - Date.now(), 0));
    if (waitMs <= 0) {
      this.drainQueue();
      return;
    }

    // Node timers overflow above the signed 32-bit range; recheck long waits in chunks.
    this.timer = setTimeout(() => this.drainQueue(), Math.min(waitMs, 2_147_483_647));
  }

  /**
   * @en Returns the number of remaining available tokens.
   * @ru Возвращает количество оставшихся доступных токенов.
   */
  public get remainingRequests(): number {
    if (!this.enabled) return Number.POSITIVE_INFINITY;
    this.refill();
    return Date.now() < this.lockedUntil ? 0 : Math.floor(this.tokens);
  }

  /**
   * @en Returns the number of currently consumed tokens (active load).
   * @ru Возвращает количество текущих потребленных токенов (активная нагрузка).
   */
  public get currentCount(): number {
    if (!this.enabled) return 0;
    this.refill();
    const count = this.max - this.tokens;
    return count < 0 ? 0 : Math.floor(count);
  }

  /**
   * @en Returns the estimated time in milliseconds until at least one token is available.
   * @ru Возвращает предполагаемое время в миллисекундах до появления хотя бы одного токена.
   */
  public get timeToReset(): number {
    if (!this.enabled) return 0;
    this.refill();
    const deficit = Math.max(0, 1 - this.tokens);
    return Math.ceil(Math.max(deficit / this.refillRate, this.lockedUntil - Date.now(), 0));
  }

  /**
   * @en Penalizes the limiter by exhausting tokens and locking for a specified duration.
   * @ru Накладывает штраф на ограничитель, исчерпывая токены и блокируя на указанное время.
   * @param durationMs - Duration of the penalty lock in milliseconds.
   */
  public penalize(durationMs: number): void {
    if (!this.enabled || !Number.isFinite(durationMs) || durationMs < 0) return;

    const now = Date.now();
    this.tokens = 0;
    this.lastRefill = now;
    this.lockedUntil = Math.max(this.lockedUntil, now + durationMs);

    this.clearTimer();
    this.scheduleDrain();
  }

  /**
   * @en Resets the limiter, clearing the queue and restoring full token capacity.
   * @ru Сбрасывает ограничитель, очищая очередь и восстанавливая полную емкость токенов.
   */
  public reset(): void {
    const error = new Error("Rate limiter has been reset");
    let current = this.head;
    this.head = null;
    this.tail = null;

    while (current !== null) {
      const next = current.next;
      if (!current.cancelled && current.reject) {
        current.reject(error);
      }
      this.releaseNode(current);
      current = next;
    }

    this.tokens = this.max;
    this.lockedUntil = 0;
    this.lastRefill = Date.now();
    this.clearTimer();
  }
}
