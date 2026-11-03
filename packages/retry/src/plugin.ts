import type {
  IHyperCore,
  HyperPlugin,
  SendRequest,
  UniversalResponse,
  HyperClientOptions,
  RetryOptions,
} from "@hyperttp/types";

export interface RetryDecision {
  request: SendRequest;
  /** One-based retry number. */
  attempt: number;
  response?: UniversalResponse;
  error?: unknown;
}

declare module "@hyperttp/types" {
  interface RetryOptions {
    enabled?: boolean;
    /** Total elapsed budget including attempts and delays; does not interrupt an active send. */
    maxElapsedMs?: number;
    /** Explicit opt-in policy for other methods/protocols. Body replay safety is still enforced. */
    shouldRetry?: (decision: RetryDecision) => boolean | Promise<boolean>;
  }
}

const installed = new WeakSet<IHyperCore>();
const retryStatuses = new Set([429, 500, 502, 503, 504]);
const networkCodes = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "EAI_AGAIN"]);

function input(request: SendRequest): Record<string, unknown> {
  return request.input && typeof request.input === "object"
    ? (request.input as Record<string, unknown>)
    : {};
}

function replayable(request: SendRequest): boolean {
  const body = input(request).body;
  if (
    body == null ||
    typeof body === "string" ||
    typeof body === "number" ||
    typeof body === "boolean"
  )
    return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return true;
  if (typeof body !== "object") return false;
  if (
    "getReader" in body ||
    "pipe" in body ||
    Symbol.asyncIterator in body ||
    (Symbol.iterator in body && !Array.isArray(body))
  )
    return false;
  const prototype = Object.getPrototypeOf(body);
  return Array.isArray(body) || prototype === Object.prototype || prototype === null;
}

function defaultDecision(decision: RetryDecision): boolean {
  if (decision.request.protocol !== "rest" || input(decision.request).stream === true) return false;
  const method = input(decision.request).method;
  if (
    typeof method !== "string" ||
    !["GET", "HEAD", "OPTIONS", "PUT", "DELETE"].includes(method.toUpperCase())
  )
    return false;
  if (decision.response) return retryStatuses.has(decision.response.status);
  const error = decision.error;
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; status?: number; statusCode?: number; name?: string };
  if (e.name === "AbortError") return false;
  return networkCodes.has(e.code ?? "") || retryStatuses.has(e.status ?? e.statusCode ?? 0);
}

function retryAfter(response?: UniversalResponse): number | undefined {
  const entry = Object.entries(response?.headers ?? {}).find(
    ([name]) => name.toLowerCase() === "retry-after",
  );
  const value = entry?.[1];
  const text = Array.isArray(value) ? value[0] : value;
  if (!text?.trim()) return;
  if (/^\d+$/.test(text.trim())) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function withRetry(
  client: IHyperCore,
  options: RetryOptions = {},
  config?: HyperClientOptions,
): IHyperCore {
  if (options.enabled === false || installed.has(client)) return client;
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 5000,
    jitter = true,
    maxElapsedMs = 30_000,
  } = options;
  if (
    !Number.isSafeInteger(maxRetries) ||
    maxRetries < 0 ||
    ![baseDelay, maxDelay, maxElapsedMs].every((value) => Number.isFinite(value) && value >= 0) ||
    maxDelay > 2_147_483_647
  ) {
    throw new TypeError("Invalid retry limits");
  }
  const next = client.send.bind(client);
  // The implementation is output-agnostic; retain both public send overloads.
  const send = async (request: SendRequest): Promise<UniversalResponse> => {
    const start = performance.now();
    const signal = request.signal ?? (input(request).signal as AbortSignal | undefined);
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let response: UniversalResponse | undefined;
      let error: unknown;
      let failed = false;
      try {
        response = await next(request);
      } catch (caught) {
        error = caught;
        failed = true;
      }
      const finish = (): UniversalResponse => {
        if (failed) throw error;
        return response!;
      };
      if (attempt >= maxRetries || !replayable(request)) return finish();
      signal?.throwIfAborted();
      if (
        !(await (options.shouldRetry ?? defaultDecision)({
          request,
          response,
          error,
          attempt: attempt + 1,
        }))
      )
        return finish();
      const serverDelay = retryAfter(response);
      // Never shorten Retry-After. Decline retry if it exceeds our delay/budget limits.
      if (serverDelay !== undefined && serverDelay > maxDelay) return finish();
      const backoff = Math.min(baseDelay * 2 ** attempt, maxDelay);
      const delay = Math.max(serverDelay ?? 0, jitter ? Math.random() * backoff : backoff);
      if (performance.now() - start + delay >= maxElapsedMs) return finish();
      if (config?.verbose)
        config.logger?.(
          "warn",
          `Request failed. Retrying attempt ${attempt + 1}/${maxRetries} after ${delay.toFixed(0)}ms`,
        );
      await wait(delay, signal);
      if (performance.now() - start >= maxElapsedMs) return finish();
    }
  };
  client.send = send as IHyperCore["send"];
  installed.add(client);
  return client;
}

/** Fresh setup-bearing plugin for each Core; retries wrap send rather than nesting in Core. */
export function createRetryPlugin(): HyperPlugin {
  return {
    name: "hyperttp-retry",
    phase: "CONTROL",
    enabled: (config) => config.retry?.enabled !== false,
    setup: ({ core, config }) => {
      withRetry(core, config.retry ?? {}, config);
    },
  };
}

/** @deprecated Use createRetryPlugin() for independent Core instances. */
export const RetryPlugin: HyperPlugin = createRetryPlugin();
