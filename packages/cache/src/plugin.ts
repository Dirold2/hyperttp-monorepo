import type { CacheManagerOptions, LightweightResponse } from "./types/cache.js";
import { CacheManager } from "hcacher";
import { createHttpResponse, createResponseSnapshot } from "./utils/createHttpResponse.js";
import type {
  HyperPlugin,
  RequestContext,
  RequestOutcome,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    cache?: CacheManagerOptions;
  }
}

interface InFlightTrigger {
  listeners: {
    resolve: (response: UniversalResponse<unknown>) => void;
    reject: (error: unknown) => void;
  }[];
}

const AUTH_IDENTITY_STATE_KEY = "@hyperttp/auth.identity";

function defaultCacheKey(request: SendRequest, context?: RequestContext): string | undefined {
  // Auth adapters may put credentials anywhere in the input. Require an explicit
  // credential-free key rather than trying to redact an unknown request shape.
  if (
    context?.state[AUTH_IDENTITY_STATE_KEY] !== undefined ||
    context?.state["@hyperttp/auth.applied"] === true
  )
    return;

  try {
    if (request.input && typeof request.input === "object") {
      const { headers } = request.input as { headers?: HeadersInit };
      if (headers) {
        const normalized = new Headers(headers);
        if (
          ["authorization", "proxy-authorization", "cookie", "x-api-key"].some((name) =>
            normalized.has(name),
          )
        ) {
          return;
        }
      }
    }

    return `${request.protocol}:${JSON.stringify({
      input: request.input,
      metadata: request.metadata,
      authIdentity: context?.state[AUTH_IDENTITY_STATE_KEY],
    })}`;
  } catch {
    return;
  }
}

function defaultShouldCache(request: SendRequest): boolean {
  if (request.protocol !== "rest" || !request.input || typeof request.input !== "object") {
    return false;
  }

  const { method } = request.input as { method?: unknown };
  return typeof method === "string" && ["GET", "HEAD"].includes(method.toUpperCase());
}

function defaultShouldStoreResponse(response: UniversalResponse): boolean {
  return response.ok;
}

export function withCache(options?: CacheManagerOptions): HyperPlugin {
  if (options?.enabled === false) {
    return { name: "hyperttp-cache" };
  }

  let cache: CacheManager<LightweightResponse<unknown>>;
  const cacheKey = options?.key ?? defaultCacheKey;
  const shouldCache = options?.shouldCache ?? defaultShouldCache;
  const shouldStoreResponse = options?.shouldStoreResponse ?? defaultShouldStoreResponse;
  const inFlight = new Map<string, InFlightTrigger>();
  const requestKeys = new WeakMap<RequestContext, string>();

  function takeRequestKey(request: SendRequest, context?: RequestContext): string | undefined {
    if (context) {
      const key = requestKeys.get(context);
      requestKeys.delete(context);
      return key;
    }

    return cacheKey(request, context);
  }

  function finish(
    key: string,
    request: SendRequest,
    context: RequestContext | undefined,
    outcome: RequestOutcome,
  ): void {
    const trigger = inFlight.get(key);
    inFlight.delete(key);
    if (!outcome.ok) {
      trigger?.listeners.forEach((listener) => listener.reject(outcome.error));
      return;
    }

    let snapshot: LightweightResponse<unknown>;
    try {
      snapshot = createResponseSnapshot(outcome.response);
    } catch (error) {
      trigger?.listeners.forEach((listener) => listener.reject(error));
      throw error;
    }
    try {
      if (shouldStoreResponse(outcome.response, request, context)) cache.set(key, snapshot);
    } finally {
      // A cache policy/storage failure must not strand successful followers.
      trigger?.listeners.forEach((listener) => listener.resolve(createHttpResponse(snapshot)));
    }
  }

  function accept(response: UniversalResponse, context?: RequestContext): UniversalResponse {
    return context?.acceptFinalResponse?.(response) ?? response;
  }

  return {
    name: "hyperttp-cache",

    setup() {
      cache = new CacheManager<LightweightResponse<unknown>>({
        maxSize: options?.maxSize ?? 1000,
        ttl: options?.ttl ?? 300_000,
        touchOnGet: options?.touchOnGet ?? true,
      });
    },

    onRequest(request, _, context) {
      const identity = context?.state[AUTH_IDENTITY_STATE_KEY];
      if (
        context?.state["@hyperttp/auth.applied"] === true &&
        (typeof identity !== "string" || !identity)
      )
        return;
      if (!shouldCache(request, context)) return;

      const key = cacheKey(request, context);
      if (!key) return;

      const cachedEntry = cache.getEntry(key);
      if (cachedEntry) {
        if (context) requestKeys.delete(context);
        return accept(createHttpResponse(cachedEntry.data), context);
      }

      const currentInFlight = inFlight.get(key);
      if (currentInFlight) {
        return new Promise<UniversalResponse<unknown>>((resolve, reject) => {
          currentInFlight.listeners.push({
            resolve: (response) => resolve(accept(response, context)),
            reject,
          });
        });
      }

      inFlight.set(key, { listeners: [] });
      if (context) requestKeys.set(context, key);
      context?.onSettled?.((outcome) => {
        requestKeys.delete(context);
        finish(key, request, context, outcome);
      });
    },

    onResponse(response, request, _, context) {
      if (!request || context?.onSettled) return;

      const key = context
        ? takeRequestKey(request, context)
        : shouldCache(request, context)
          ? takeRequestKey(request, context)
          : undefined;
      if (!key) return;

      finish(key, request, context, { ok: true, response });
    },

    onError(error, request, _, context) {
      if (!request || context?.onSettled) return;

      const key = context
        ? takeRequestKey(request, context)
        : shouldCache(request, context)
          ? takeRequestKey(request, context)
          : undefined;
      if (!key) return;

      finish(key, request, context, { ok: false, error });
    },
  };
}
