import type { RequestContext, SendRequest } from "@hyperttp/types";

/** Configuration for protocol-neutral request concurrency control. */
export interface QueueOptions {
  enabled?: boolean;
  /** Maximum concurrent requests in each partition. */
  maxConcurrent?: number;
  /** Returns the partition whose concurrency limit applies to this request. */
  partitionKey?: (request: SendRequest, context?: RequestContext) => string;
}

export type Executor<T> = () => Promise<T>;

export interface QueueNode {
  executor: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  next: QueueNode | null;
}

export type Scheduler = (cb: () => void) => void;
