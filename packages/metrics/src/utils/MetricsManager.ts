import type { CollectedRequestMetrics, MetricsOptions } from "../types/metrics.js";

interface InternalMetricsEntry {
  data: CollectedRequestMetrics;
  expiresAt: number;
}

export class MetricsManager {
  private readonly storage = new Map<string, InternalMetricsEntry>();
  private readonly latestByKey = new Map<string, CollectedRequestMetrics>();

  private readonly maxSize: number;
  private readonly ttl: number;

  private _totalBytesAccumulator = 0;
  private _recordId = 0;

  constructor(config?: MetricsOptions) {
    this.maxSize = config?.maxHistory ?? 1000;
    this.ttl = config?.ttl ?? 1000 * 60 * 60; // 1 час по умолчанию
  }

  /**
   * @ru Записывает метрику запроса в историю.
   * @en Stores request metrics inside the telemetry history.
   */
  record(metrics: CollectedRequestMetrics): void {
    this.storeMetrics(metrics);
    if (metrics.operationKey) this.latestByKey.set(metrics.operationKey, metrics);
    if (metrics.url) this.latestByKey.set(metrics.url, metrics);
  }

  /**
   * @ru Возвращает метрику по точному ключу истории или последнюю по URL.
   * @en Returns metric by exact key or latest metric by URL.
   */
  get(key: string): CollectedRequestMetrics | undefined {
    const exact = this.storage.get(key);

    if (exact) {
      if (Date.now() > exact.expiresAt) {
        this.storage.delete(key);
        return this.latestByKey.get(key);
      }
      return exact.data;
    }

    return this.latestByKey.get(key);
  }

  /**
   * @ru Возвращает все валидные (не протухшие) метрики и лениво очищает старые.
   * @en Returns all non-expired metrics and lazily purges expired ones.
   */
  getAll(): CollectedRequestMetrics[] {
    const now = Date.now();
    const result: CollectedRequestMetrics[] = [];

    // Ленивая инвалидация: совмещаем сборку актуальных данных и очистку памяти
    for (const [key, entry] of this.storage.entries()) {
      if (now > entry.expiresAt) {
        this.storage.delete(key);
      } else {
        result.push(entry.data);
      }
    }

    return result;
  }

  /**
   * @ru Регистрирует объем полученных байтов.
   * @en Records incoming transferred bytes.
   */
  recordBytes(bytes: number): void {
    this._totalBytesAccumulator += Math.max(0, bytes);
  }

  /**
   * @ru Возвращает агрегированную сводку метрик.
   * @en Returns aggregated telemetry summary.
   */
  getSummary() {
    const all = this.getAll();
    const total = all.length;

    if (total === 0) {
      return null;
    }

    let successful = 0;
    let totalDuration = 0;
    let maxDuration = 0;
    let totalSerialization = 0;
    let totalNetwork = 0;

    const durations = Array.from({ length: total }, () => 0);

    for (let i = 0; i < total; i++) {
      const metric = all[i];
      const status = metric.statusCode ?? (typeof metric.status === "number" ? metric.status : 0);
      const succeeded = metric.outcome
        ? metric.outcome === "success"
        : status >= 100 && status < 400;

      if (succeeded) {
        successful++;
      }

      totalDuration += metric.duration;

      if (metric.duration > maxDuration) {
        maxDuration = metric.duration;
      }

      durations[i] = metric.duration;

      totalSerialization += metric.stages?.serializationMs ?? 0;
      totalNetwork += metric.stages?.networkMs ?? 0;
    }

    durations.sort((a, b) => a - b);

    return {
      totalRequests: total,
      successRate: (successful / total) * 100,
      avgDurationMs: Math.round(totalDuration / total),
      totalBytesReceived: this._totalBytesAccumulator,
      errorCount: total - successful,
      maxDurationMs: maxDuration,
      p99DurationMs: this.percentileSorted(durations, 99),
      bottlenecks: {
        serialization: (totalSerialization / total).toFixed(2) + "ms",
        network: (totalNetwork / total).toFixed(2) + "ms",
      },
    };
  }

  /**
   * @ru Полностью очищает историю метрик.
   * @en Clears all stored telemetry data.
   */
  clear(): void {
    this.storage.clear();
    this.latestByKey.clear();

    this._totalBytesAccumulator = 0;
    this._recordId = 0;
  }

  /**
   * @private
   * @ru Сохраняет запись метрики в FIFO/LRU структуру нативного Map.
   * @en Persists metrics record into the native Map FIFO/LRU structure.
   */
  private storeMetrics(metrics: CollectedRequestMetrics): void {
    const key = `${metrics.operationKey ?? `${metrics.method ?? "unknown"}:${metrics.url ?? metrics.protocol ?? "unknown"}`}:${Date.now()}:${this._recordId++}`;

    // Выселяем самую старую запись по хронологии за O(1), если превышен лимит размера
    if (this.storage.size >= this.maxSize && !this.storage.has(key)) {
      const oldestKey = this.storage.keys().next().value;
      if (oldestKey !== undefined) {
        this.storage.delete(oldestKey);
      }
    }

    this.storage.set(key, {
      data: metrics,
      expiresAt: Date.now() + this.ttl,
    });

    if (this._recordId > 1_000_000_000) {
      this._recordId = 0;
    }
  }

  /**
   * @private
   * @ru Вычисляет процентиль по заранее отсортированному массиву.
   * @en Calculates percentile from a pre-sorted numeric array.
   */
  private percentileSorted(sorted: number[], p: number): number {
    if (sorted.length === 0) {
      return 0;
    }

    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);

    if (low === high) {
      return sorted[low];
    }

    const weight = rank - low;
    return Math.round(sorted[low] * (1 - weight) + sorted[high] * weight);
  }
}
