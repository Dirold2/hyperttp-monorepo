import type {
  IHyperCore,
  RequestContext,
  RequestMetrics,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import type { MetricsManager } from "../utils/MetricsManager.js";

export type MetricLabelValue = string | number | boolean;
export type RequestMetricLabels = Readonly<Record<string, MetricLabelValue>>;
export type MetricOutcome = "success" | "failure";
export type MetricStatus = string | number;

export interface MetricsExtractionContext {
  request: SendRequest;
  requestContext: RequestContext;
  response: UniversalResponse | null;
  error: unknown;
}

/**
 * Explicit overrides: results are stored as returned, without default URL sanitization.
 * Custom extractors must redact credentials and other secrets themselves.
 */
export interface MetricsExtractors {
  operationKey?: (context: MetricsExtractionContext) => string | undefined;
  requestLabels?: (context: MetricsExtractionContext) => RequestMetricLabels | undefined;
  outcome?: (context: MetricsExtractionContext) => MetricOutcome | undefined;
  status?: (context: MetricsExtractionContext) => MetricStatus | undefined;
  bytesSent?: (context: MetricsExtractionContext) => number | undefined;
  bytesReceived?: (context: MetricsExtractionContext) => number | undefined;
  cached?: (context: MetricsExtractionContext) => boolean | undefined;
}

declare module "@hyperttp/types" {
  interface RequestMetrics {
    protocol?: string;
    operationKey?: string;
    requestLabels?: RequestMetricLabels;
    outcome?: MetricOutcome;
    status?: MetricStatus;
  }
}

/**
 * RequestMetrics with optional protocol-neutral fields supplied by this package.
 * The legacy REST fields (method, url and statusCode) remain unchanged.
 */
export type CollectedRequestMetrics = RequestMetrics;

export interface MetricsOptions {
  /**
   * @ru Включить сбор метрик
   * @en Enable metrics collection
   */
  enabled?: boolean;

  /** Protocol-specific metric extraction overrides. */
  extractors?: MetricsExtractors;

  /**
   * @ru Максимальное количество записей в истории.
   * @en Maximum number of entries in history.
   */
  maxHistory?: number;

  /**
   * @ru Время хранения метрик в миллисекундах.
   * @en Time to keep metrics in milliseconds.
   */
  ttl?: number;

  /**
   * @ru Глубина scope для circuit breaker: 1 = host + первый сегмент пути.
   * @en Scope depth for circuit breaker: 1 = host + first path segment.
   */
  scopeDepth?: number;

  /**
   * @ru Порог ошибки, после которого circuit breaker переходит в OPEN.
   * @en Failure score threshold that opens the circuit breaker.
   */
  failureThreshold?: number;

  /**
   * @ru Время охлаждения перед переходом в HALF_OPEN.
   * @en Cooldown time before switching to HALF_OPEN.
   */
  resetTimeout?: number;

  /**
   * @ru Порог "медленного" запроса в миллисекундах.
   * @en Slow request threshold in milliseconds.
   */
  slowRequestMs?: number;

  skipCircuitBreaker?: boolean;

  /**
   * @ru Веса ошибок для разных классов отказов.
   * @en Failure weights for different failure classes.
   */
  weights?: {
    timeout?: number;
    serverError?: number;
    rateLimit?: number;
    slowRequest?: number;
    other?: number;
  };
}

export type CircuitStateName = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CircuitState = {
  state: CircuitStateName;
  failureScore: number;
  consecutiveFailures: number;
  lastFailureTime: number;
  lastTransitionTime: number;
  probeInFlight: boolean;
};

export interface MemoryUsageSnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface RequestPerformanceProfile {
  wallClockStart: number;
  wallClockEnd: number;
  durationMs: number;
  cpu: {
    userMs: number;
    systemMs: number;
    totalMs: number;
    percent: number;
  };
  memory: {
    before: MemoryUsageSnapshot;
    after: MemoryUsageSnapshot;
    delta: MemoryUsageSnapshot;
  };
}

export interface MetaWithTimings {
  retryCount?: number;
  timings?: {
    serializationMs?: number;
    networkMs?: number;
    [key: string]: number | undefined;
  };
}

export interface ResponseWithCacheFlags {
  fromCache?: boolean;
}

export type MetricsCoreExtension = IHyperCore & {
  getAllMetrics: () => RequestMetrics[];
  getMetricsSummary: () => ReturnType<MetricsManager["getSummary"]>;
};
