import type {
  HyperPlugin,
  HyperClientOptions,
  UniversalResponse,
  PluginContext,
  SendRequest,
  RequestContext,
} from "@hyperttp/types";
import { QueueManager } from "./utils/QueueManager.js";
import type { QueueOptions } from "./types/queue.js";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    queue?: QueueOptions;
  }
}

const DEFAULT_PARTITION = "default";

export function withQueue(options?: QueueOptions): HyperPlugin {
  const queues = new Map<string, QueueManager>();
  const settlementKeys = new WeakSet<object>();
  const releases = new WeakMap<object, () => void>();
  let maxConcurrent = 500;
  let partitionKey: QueueOptions["partitionKey"];

  function removeIdleQueue(partition: string, queue: QueueManager): void {
    if (queue.activeCount === 0 && queue.queuedCount === 0 && queues.get(partition) === queue) {
      queues.delete(partition);
    }
  }

  function release(req?: SendRequest, reqCtx?: RequestContext): void {
    const key = reqCtx ?? req;
    if (!key || settlementKeys.has(key)) return;
    releases.get(key)?.();
    releases.delete(key);
  }

  return {
    name: "hyperttp-queue",
    enabled: (config: HyperClientOptions): boolean =>
      config.queue?.enabled ?? options?.enabled ?? options !== undefined,
    setup(ctx: PluginContext): void {
      queues.clear();
      const configured = ctx.config.queue;
      const legacyMaxConcurrent = (
        ctx.config as HyperClientOptions & { network?: { maxConcurrent?: number } }
      ).network?.maxConcurrent;
      maxConcurrent =
        configured?.maxConcurrent ?? options?.maxConcurrent ?? legacyMaxConcurrent ?? 500;
      if (!Number.isFinite(maxConcurrent)) {
        throw new RangeError("maxConcurrent must be a finite number");
      }
      partitionKey = configured?.partitionKey ?? options?.partitionKey;
    },
    async onRequest(
      req: SendRequest,
      _ctx?: PluginContext,
      reqCtx?: RequestContext,
    ): Promise<void> {
      const requestSignal = req.signal;
      const contextSignal = reqCtx?.signal;
      const signal =
        requestSignal && contextSignal && requestSignal !== contextSignal
          ? AbortSignal.any([requestSignal, contextSignal])
          : (requestSignal ?? contextSignal);
      if (signal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }

      const partition = partitionKey?.(req, reqCtx) ?? DEFAULT_PARTITION;
      let queue = queues.get(partition);
      if (!queue) {
        queue = new QueueManager(maxConcurrent);
        queues.set(partition, queue);
      }

      try {
        const releaseSlot = await queue.acquire(signal);
        const key = reqCtx ?? req;
        const releaseAcquired = (): void => {
          if (releases.get(key) !== releaseAcquired) return;
          releases.delete(key);
          releaseSlot();
          removeIdleQueue(partition, queue);
        };
        releases.set(key, releaseAcquired);
        const lifecycleCtx = reqCtx;
        if (typeof lifecycleCtx?.onSettled === "function") {
          settlementKeys.add(key);
          lifecycleCtx.onSettled(() => releaseAcquired());
        }
      } catch (error) {
        removeIdleQueue(partition, queue);
        throw error;
      }
    },
    onResponse(
      _res: UniversalResponse,
      req?: SendRequest,
      _ctx?: PluginContext,
      reqCtx?: RequestContext,
    ): void {
      release(req, reqCtx);
    },
    onError(_err: unknown, req?: SendRequest, _ctx?: PluginContext, reqCtx?: RequestContext): void {
      release(req, reqCtx);
    },
  };
}
