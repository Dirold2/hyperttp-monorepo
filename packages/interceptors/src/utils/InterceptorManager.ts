import type {
  PluginContext,
  RequestContext,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import type { RequestInterceptor, ResponseInterceptor } from "../types/interceptors.js";

export class InterceptorManager {
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  public hasRequest = false;
  public hasResponse = false;

  addRequest(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
    this.hasRequest = true;
  }

  addResponse(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
    this.hasResponse = true;
  }

  applyRequest(
    request: SendRequest,
    context?: PluginContext,
    requestContext?: RequestContext,
  ): SendRequest | Promise<SendRequest> {
    let result = request;
    for (let i = 0; i < this.requestInterceptors.length; i++) {
      const next = this.requestInterceptors[i](result, context, requestContext);
      if (next instanceof Promise) {
        return this.applyRequestAsync(i + 1, next, result, context, requestContext);
      }
      if (next) result = next;
    }
    return result;
  }

  private async applyRequestAsync(
    startIndex: number,
    currentPromise: Promise<SendRequest | void>,
    currentResult: SendRequest,
    context?: PluginContext,
    requestContext?: RequestContext,
  ): Promise<SendRequest> {
    let result = (await currentPromise) ?? currentResult;
    for (let i = startIndex; i < this.requestInterceptors.length; i++) {
      const next = this.requestInterceptors[i](result, context, requestContext);
      result = (next instanceof Promise ? await next : next) ?? result;
    }
    return result;
  }

  applyResponse(
    response: UniversalResponse,
    request?: SendRequest,
    context?: PluginContext,
    requestContext?: RequestContext,
  ): UniversalResponse | Promise<UniversalResponse> {
    let result = response;
    for (let i = 0; i < this.responseInterceptors.length; i++) {
      const nextResponse = this.responseInterceptors[i](result, request, context, requestContext);
      if (nextResponse instanceof Promise) {
        return this.applyResponseAsync(
          i + 1,
          nextResponse,
          result,
          request,
          context,
          requestContext,
        );
      }
      if (nextResponse) result = nextResponse;
    }
    return result;
  }

  private async applyResponseAsync(
    startIndex: number,
    currentPromise: Promise<UniversalResponse | void>,
    currentResult: UniversalResponse,
    request?: SendRequest,
    context?: PluginContext,
    requestContext?: RequestContext,
  ): Promise<UniversalResponse> {
    let result = (await currentPromise) ?? currentResult;
    for (let i = startIndex; i < this.responseInterceptors.length; i++) {
      const nextResponse = this.responseInterceptors[i](result, request, context, requestContext);
      result = (nextResponse instanceof Promise ? await nextResponse : nextResponse) ?? result;
    }
    return result;
  }

  clear(): void {
    this.requestInterceptors = [];
    this.responseInterceptors = [];
    this.hasRequest = false;
    this.hasResponse = false;
  }
}
