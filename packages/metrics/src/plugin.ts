import type {
  HyperClientOptions,
  HyperPlugin,
  RequestContext,
  RequestMetrics,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import type {
  CollectedRequestMetrics,
  MetricStatus,
  MetricsExtractionContext,
  MetricsOptions,
  RequestMetricLabels,
} from "./types/metrics.js";
import { MetricsManager } from "./utils/MetricsManager.js";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    metrics?: MetricsOptions;
  }
  interface IHyperCore {
    getMetrics?: (key: string) => RequestMetrics | RequestMetrics[] | undefined;
    getAllMetrics?: () => RequestMetrics[];
    getMetricsSummary?: () => ReturnType<MetricsManager["getSummary"]> | null;
    getStats?: () => ReturnType<MetricsManager["getSummary"]> | null;
    resetMetrics?: () => void;
    resetCircuits?: () => void;
  }
}

interface InflightTiming {
  wallClockStart: number;
  hrStart: number;
}

interface RestInput {
  method?: string;
  url?: string;
  headers?: Readonly<Record<string, unknown>>;
  body?: unknown;
}

const TIMING_KEY = "hyperttp.metrics.timing";

function restInput(request: SendRequest): RestInput {
  return request.input !== null && typeof request.input === "object"
    ? (request.input as RestInput)
    : {};
}

function mergedMetadata(request: SendRequest, context: RequestContext): Record<string, unknown> {
  return { ...context.meta, ...request.metadata };
}

function headerNumber(headers: Readonly<Record<string, unknown>> | undefined): number | undefined {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== "content-length") continue;
    const parsed = Number(Array.isArray(value) ? value[0] : value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

function payloadBytes(payload: unknown): number {
  if (typeof payload === "string") return new TextEncoder().encode(payload).byteLength;
  if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) return payload.byteLength;
  if (typeof Blob !== "undefined" && payload instanceof Blob) return payload.size;
  return 0;
}

function safeUrlLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://metrics.invalid/");
    // Non-network URLs can embed arbitrary credentials in their pathname.
    if (!["http:", "https:", "ftp:", "ws:", "wss:"].includes(url.protocol)) return undefined;
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(value.trim()) || /^[\\/]{2}/.test(value.trim());
    return absolute ? `${url.origin}${url.pathname}` : url.pathname;
  } catch {
    // Never fall back to the raw input when parsing fails.
    return undefined;
  }
}

function defaultLabels(context: MetricsExtractionContext): RequestMetricLabels | undefined {
  const input = restInput(context.request);
  const labels: Record<string, string> = {};
  if (input.method) labels.method = input.method;
  const url = safeUrlLabel(input.url);
  if (url) labels.url = url;
  return Object.keys(labels).length > 0 ? labels : undefined;
}

function defaultOperationKey(context: MetricsExtractionContext): string | undefined {
  const input = restInput(context.request);
  const url = safeUrlLabel(input.url);
  if (input.method && url) return `${input.method} ${url}`;
  return url ?? input.method;
}

function defaultStatus(context: MetricsExtractionContext): MetricStatus {
  if (context.response) return context.response.status;
  const error = context.error as Record<string, unknown> | null;
  if (typeof error?.status === "number" || typeof error?.status === "string") return error.status;
  if (typeof error?.statusCode === "number" || typeof error?.statusCode === "string")
    return error.statusCode;
  return 500;
}

function defaultCached(context: MetricsExtractionContext): boolean {
  const responseMetadata = context.response?.metadata as Record<string, unknown> | undefined;
  const requestMetadata = mergedMetadata(context.request, context.requestContext);
  return Boolean(
    responseMetadata?.cached ??
    responseMetadata?.fromCache ??
    requestMetadata.cached ??
    requestMetadata.fromCache ??
    false,
  );
}

function extractMetrics(
  options: MetricsOptions,
  context: MetricsExtractionContext,
): Omit<CollectedRequestMetrics, "startTime" | "endTime" | "duration" | "retries" | "stages"> {
  const { extractors = {} } = options;
  const input = restInput(context.request);
  const labels = extractors.requestLabels
    ? extractors.requestLabels(context)
    : defaultLabels(context);
  const operationKey = extractors.operationKey
    ? extractors.operationKey(context)
    : defaultOperationKey(context);
  const status = extractors.status ? extractors.status(context) : defaultStatus(context);
  const outcome = extractors.outcome
    ? extractors.outcome(context)
    : context.error
      ? "failure"
      : context.response?.ok
        ? "success"
        : "failure";
  const bytesSent = Math.max(
    0,
    extractors.bytesSent
      ? (extractors.bytesSent(context) ?? 0)
      : (headerNumber(input.headers) ?? payloadBytes(input.body)),
  );
  const bytesReceived = Math.max(
    0,
    extractors.bytesReceived
      ? (extractors.bytesReceived(context) ?? 0)
      : (headerNumber(context.response?.headers) ??
          payloadBytes(context.response?.raw ?? context.response?.data)),
  );
  const cached = extractors.cached ? (extractors.cached(context) ?? false) : defaultCached(context);

  return {
    protocol: context.request.protocol,
    operationKey,
    requestLabels: labels,
    outcome,
    status,
    statusCode: typeof status === "number" ? status : undefined,
    method: typeof labels?.method === "string" ? labels.method : undefined,
    url: typeof labels?.url === "string" ? labels.url : undefined,
    bytesSent,
    bytesReceived,
    cached,
  };
}

function recordMetrics(
  metrics: MetricsManager,
  options: MetricsOptions,
  request: SendRequest | undefined,
  requestContext: RequestContext | undefined,
  response: UniversalResponse | null,
  error: unknown,
): void {
  if (!request || !requestContext) return;
  const timing = requestContext.state[TIMING_KEY] as InflightTiming | undefined;
  if (!timing) return;
  delete requestContext.state[TIMING_KEY];

  try {
    const metadata = mergedMetadata(request, requestContext);
    const timings = (metadata.timings ?? {}) as {
      serializationMs?: number;
      networkMs?: number;
    };
    const extracted = extractMetrics(options, {
      request,
      requestContext,
      response,
      error,
    });
    const record = {
      ...extracted,
      duration: performance.now() - timing.hrStart,
      startTime: timing.wallClockStart,
      endTime: Date.now(),
      retries: typeof metadata.retryCount === "number" ? metadata.retryCount : 0,
      stages: {
        serializationMs: timings.serializationMs ?? 0,
        networkMs: timings.networkMs ?? 0,
      },
    } satisfies CollectedRequestMetrics;

    metrics.record(record);
    if (record.bytesReceived > 0) metrics.recordBytes(record.bytesReceived);
  } catch {
    // Telemetry must never affect the request.
  }
}

export function withMetrics(options?: Partial<MetricsOptions>): HyperPlugin {
  let metrics: MetricsManager | undefined;
  let resolvedOptions: MetricsOptions = options ?? {};

  return {
    name: "hyperttp-metrics",
    enabled: (config: HyperClientOptions): boolean =>
      config.metrics?.enabled ?? config.trackMetrics !== false,
    setup(context) {
      resolvedOptions = { ...context.config.metrics, ...options };
      metrics = new MetricsManager(resolvedOptions);
      if (context.core) {
        context.core.getMetrics = (key) => metrics?.get(key);
        context.core.getAllMetrics = () => metrics?.getAll() ?? [];
        context.core.getMetricsSummary = () => metrics?.getSummary() ?? null;
        context.core.getStats = () => metrics?.getSummary() ?? null;
        context.core.resetMetrics = () => metrics?.clear();
        context.core.resetCircuits = () => {};
      }
    },
    onRequest(_request, _context, requestContext) {
      if (!requestContext) return;
      requestContext.state[TIMING_KEY] = {
        wallClockStart: Date.now(),
        hrStart: performance.now(),
      } satisfies InflightTiming;
      requestContext.onSettled?.((outcome) => {
        if (metrics)
          recordMetrics(
            metrics,
            resolvedOptions,
            _request,
            requestContext,
            outcome.ok ? outcome.response : null,
            outcome.ok ? null : outcome.error,
          );
      });
    },
    onResponse(response, request, _context, requestContext) {
      if (metrics && !requestContext?.onSettled)
        recordMetrics(metrics, resolvedOptions, request, requestContext, response, null);
    },
    onError(error, request, _context, requestContext) {
      if (metrics && !requestContext?.onSettled)
        recordMetrics(metrics, resolvedOptions, request, requestContext, null, error);
    },
  };
}
