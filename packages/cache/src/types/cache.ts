import type { RequestContext, SendRequest, UniversalResponse } from "@hyperttp/types";
import type { CacheManagerOptions as HcacherOptions } from "hcacher";

export type { CacheEntry } from "hcacher";

/** Configuration options for the cache manager. */
export interface CacheManagerOptions extends HcacherOptions {
  /** Returns a credential-free cache key including a non-secret auth identity.
   * Return undefined when authenticated requests have no safe identity scope.
   * Custom auth headers, query credentials and protocol adapters require this callback.
   */
  key?: (request: SendRequest, context?: RequestContext) => string | undefined;

  /** By default, only REST GET and HEAD requests use the cache. */
  shouldCache?: (request: SendRequest, context?: RequestContext) => boolean;

  /** By default, only successful responses are stored. */
  shouldStoreResponse?: (
    response: UniversalResponse,
    request: SendRequest,
    context?: RequestContext,
  ) => boolean;
}

/** A serializable snapshot of a protocol-neutral response. */
export interface LightweightResponse<T = unknown> {
  protocol: string;
  ok: boolean;
  status: number;
  statusText?: string;
  headers: Record<string, string | string[]>;
  url?: string;
  data: T;
  metadata?: Record<string, unknown>;
}
