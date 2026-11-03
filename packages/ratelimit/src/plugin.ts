import type {
  HyperPlugin,
  HyperClientOptions,
  UniversalResponse,
  PluginContext,
  SendRequest,
  RequestContext,
  IHyperCore,
} from "@hyperttp/types";
import { RateLimiter } from "./utils/RateLimiter.js";
import type { RateLimitOptions } from "./types/limiter.js";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    rateLimit?: RateLimitOptions;
  }

  interface PluginContext {
    rateLimiter?: RateLimiter;
  }
}

function getHeader(
  headers: Readonly<Record<string, string | string[]>> | undefined,
  name: string,
): string | string[] | undefined {
  if (!headers) return undefined;
  const lookup = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lookup) return value;
  }
  return undefined;
}

function retryAfterPenalty(response?: UniversalResponse): number {
  const retryAfterHeader = response && getHeader(response.headers, "retry-after");
  const retryAfter = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
  const value = retryAfter?.trim();
  if (!value) return 2000;

  if (/^\d+$/.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : 2000;
  }

  // Date.parse also accepts non-HTTP values such as ISO dates and signed numbers.
  const weekday = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
  const month = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
  const time = "(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d";
  const day = "(?:0[1-9]|[12]\\d|3[01])";
  const httpDate = new RegExp(
    `^(?:${weekday}, ${day} ${month} \\d{4} ${time} GMT|` +
      `(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ${day}-${month}-\\d{2} ${time} GMT|` +
      `${weekday} ${month} (?: [1-9]|[12]\\d|3[01]) ${time} \\d{4})$`,
  );
  if (!httpDate.test(value)) return 2000;

  const date = Date.parse(value.endsWith("GMT") ? value : `${value} GMT`);
  if (!Number.isFinite(date)) return 2000;
  const parts = value.split(/\s+/);
  const expectedDay = Number(value.includes(",") ? parts[1]!.split("-")[0] : parts[2]);
  if (new Date(date).getUTCDate() !== expectedDay) return 2000;
  return Math.max(0, date - Date.now());
}

function defaultResponsePenalty(response: UniversalResponse): number | false {
  return response.protocol === "rest" && response.status === 429
    ? retryAfterPenalty(response)
    : false;
}

function defaultErrorPenalty(error: unknown): number | false {
  const target = error as Record<string, unknown> | null;
  const response = target?.response as UniversalResponse | undefined;
  const status = target?.status ?? target?.statusCode ?? response?.status;
  if (status !== 429) return false;
  if (response && response.protocol !== "rest") return false;
  return retryAfterPenalty(response);
}

function applyPenalty(limiter: RateLimiter, decision: number | false | null | undefined): void {
  if (typeof decision === "number" && Number.isFinite(decision) && decision >= 0) {
    limiter.penalize(decision);
  }
}

export function withRateLimit(options?: Partial<RateLimitOptions>): HyperPlugin {
  type State = { limiter: RateLimiter; finalOptions: RateLimitOptions };
  const states = new WeakMap<PluginContext, State>();
  let lastState: State | undefined;

  function getState(ctx?: PluginContext): State {
    const state = ctx ? states.get(ctx) : lastState;
    if (!state) throw new Error("Rate-limit plugin must be set up for this context first");
    return state;
  }

  return {
    name: "hyperttp-ratelimit",
    enabled: (config: HyperClientOptions): boolean =>
      options?.enabled ?? config.rateLimit?.enabled ?? false,
    setup(ctx: PluginContext): void {
      const finalOptions: RateLimitOptions = {
        ...ctx.config.rateLimit,
        ...options,
        enabled: options?.enabled ?? ctx.config.rateLimit?.enabled ?? true,
      };

      const limiter = new RateLimiter(finalOptions);
      lastState = { limiter, finalOptions };
      states.set(ctx, lastState);
      ctx.rateLimiter = limiter;

      const core = ctx.core as IHyperCore & {
        getStats?: () => Record<string, unknown> & {
          currentRateLimit?: number;
        };
      };
      if (typeof core.getStats === "function") {
        const originalGetStats = core.getStats;
        core.getStats = function () {
          const stats = originalGetStats.call(core);
          if (stats) stats.currentRateLimit = limiter.currentCount;
          return stats;
        };
      }
    },
    async onRequest(req: SendRequest, ctx?: PluginContext, reqCtx?: RequestContext): Promise<void> {
      const { limiter, finalOptions } = getState(ctx);
      if (!finalOptions.enabled) return;
      const weight = finalOptions.getRequestWeight
        ? await finalOptions.getRequestWeight(req, reqCtx)
        : 1;
      const maybePromise = limiter.wait(weight, req.signal ?? reqCtx?.signal);
      if (maybePromise) await maybePromise;
    },
    async onResponse(res, req, ctx, reqCtx): Promise<void> {
      const { limiter, finalOptions } = getState(ctx);
      if (!finalOptions.enabled) return;
      const getPenalty = finalOptions.getResponsePenalty ?? defaultResponsePenalty;
      applyPenalty(limiter, await getPenalty(res, req, reqCtx));
    },
    async onError(err, req, ctx, reqCtx): Promise<void> {
      const { limiter, finalOptions } = getState(ctx);
      if (!finalOptions.enabled) return;
      const getPenalty = finalOptions.getErrorPenalty ?? defaultErrorPenalty;
      applyPenalty(limiter, await getPenalty(err, req, reqCtx));
    },
  };
}
