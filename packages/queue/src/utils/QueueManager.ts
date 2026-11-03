/**
 * @ru Функция для освобождения захваченного слота в очереди.
 * @en Function to release an acquired slot in the queue.
 */
type Release = () => void;

/**
 * @ru Объект ожидающего выполнения запроса.
 * @en A pending request waiter object.
 */
interface Waiter {
  /**
   * @ru Функция разрешения промиса при получении слота.
   * @en Resolution handler for the promise when a slot is acquired.
   */
  resolve: (release: Release) => void;

  /**
   * @ru Функция отклонения промиса при ошибке.
   * @en Rejection handler for the promise on error.
   */
  reject: (reason: unknown) => void;
}

/**
 * @ru Менеджер очереди с ограничением конкурентных запросов.
 * @en Queue manager with concurrent request limit.
 */
export class QueueManager {
  private running = 0;
  private readonly _maxConcurrent: number;
  private readonly waiters: Waiter[] = [];

  /**
   * @ru Создаёт менеджер очереди.
   * @en Creates a queue manager.
   * @param maxConcurrent - @ru Максимальное количество одновременно выполняемых операций. @en Maximum number of concurrent operations.
   */
  constructor(maxConcurrent = 50) {
    if (!Number.isFinite(maxConcurrent)) {
      throw new RangeError("maxConcurrent must be a finite number");
    }
    this._maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  }

  private createRelease(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  /**
   * @ru Запрашивает слот для выполнения операции.
   * @en Acquires a slot to execute an operation.
   * @param signal - @ru AbortSignal для отмены ожидания. @en AbortSignal to cancel waiting.
   * @returns @ru Promise с функцией освобождения слота. @en Promise with a release function.
   */
  public acquire(signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("The user aborted a request.", "AbortError"));
    }

    if (this.running < this._maxConcurrent) {
      this.running++;
      return Promise.resolve(this.createRelease());
    }

    return new Promise<Release>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (res) => {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          resolve(res);
        },
        reject: (err) => {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          reject(err);
        },
      };

      this.waiters.push(waiter);

      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        waiter.reject(new DOMException("The user aborted a request.", "AbortError"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * @ru Освобождает занятый слот и запускает следующий ожидающий запрос.
   * @en Releases an acquired slot and starts the next waiting request.
   */
  private release(): void {
    this.running--;

    const waiter = this.waiters.shift();
    if (waiter) {
      this.running++;
      waiter.resolve(this.createRelease());
    }
  }

  /**
   * @ru Текущее количество активных операций.
   * @en Current number of active operations.
   */
  get activeCount(): number {
    return this.running;
  }

  /**
   * @ru Количество операций, ожидающих в очереди.
   * @en Number of operations waiting in the queue.
   */
  get queuedCount(): number {
    return this.waiters.length;
  }
}
