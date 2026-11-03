import type {
  PluginContext,
  RequestContext,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";

export interface InterceptorOptions {
  enabled?: boolean;
  request?: RequestInterceptor | readonly RequestInterceptor[];
  response?: ResponseInterceptor | readonly ResponseInterceptor[];
}

export type RequestInterceptor = (
  request: SendRequest,
  context?: PluginContext,
  requestContext?: RequestContext,
) => SendRequest | void | Promise<SendRequest | void>;

export type ResponseInterceptor = (
  response: UniversalResponse,
  request?: SendRequest,
  context?: PluginContext,
  requestContext?: RequestContext,
) => UniversalResponse | void | Promise<UniversalResponse | void>;
