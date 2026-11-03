import type {
  HyperPlugin,
  HyperClientOptions,
  UniversalResponse,
  PluginContext,
  SendRequest,
  RequestContext,
} from "@hyperttp/types";
import { InterceptorManager } from "./utils/InterceptorManager.js";
import type {
  InterceptorOptions,
  RequestInterceptor,
  ResponseInterceptor,
} from "./types/interceptors.js";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    interceptors?: InterceptorOptions;
  }

  interface PluginContext {
    interceptors?: InterceptorManager;
  }
}

function register<T>(value: T | readonly T[] | undefined, add: (interceptor: T) => void): void {
  if (!value) return;
  (Array.isArray(value) ? value : [value]).forEach(add);
}

export function withInterceptors(options?: InterceptorOptions): HyperPlugin {
  let fallbackManager: InterceptorManager | undefined;

  return {
    name: "hyperttp-interceptors",
    enabled: (config: HyperClientOptions): boolean =>
      config.interceptors?.enabled ??
      options?.enabled ??
      (config.interceptors !== undefined || options !== undefined),
    setup(ctx: PluginContext): void {
      const manager = new InterceptorManager();
      fallbackManager = manager;
      const configured = ctx.config.interceptors;
      register<RequestInterceptor>(options?.request, (interceptor) =>
        manager.addRequest(interceptor),
      );
      register<ResponseInterceptor>(options?.response, (interceptor) =>
        manager.addResponse(interceptor),
      );
      register<RequestInterceptor>(configured?.request, (interceptor) =>
        manager.addRequest(interceptor),
      );
      register<ResponseInterceptor>(configured?.response, (interceptor) =>
        manager.addResponse(interceptor),
      );
      ctx.interceptors = manager;
    },
    async onRequest(
      req: SendRequest,
      ctx?: PluginContext,
      reqCtx?: RequestContext,
    ): Promise<SendRequest | void> {
      const manager = ctx ? ctx.interceptors : fallbackManager;
      if (!manager?.hasRequest) return;
      return manager.applyRequest(req, ctx, reqCtx);
    },
    async onResponse(
      res: UniversalResponse,
      req?: SendRequest,
      ctx?: PluginContext,
      reqCtx?: RequestContext,
    ): Promise<UniversalResponse | void> {
      const manager = ctx ? ctx.interceptors : fallbackManager;
      if (!manager?.hasResponse) return;
      return manager.applyResponse(res, req, ctx, reqCtx);
    },
  };
}
