import type { UniversalResponse } from "@hyperttp/types";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

export interface RestInput<TBody = unknown> {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | (string | number | boolean)[]>;
  body?: TBody;
  timeout?: number;
}

export type RestRequestOptions = Omit<RestInput, "method" | "url">;

export interface RestClientMethods extends Record<string, any> {
  get<T = unknown>(url: string, options?: RestRequestOptions): Promise<UniversalResponse<T>>;
  post<T = unknown>(url: string, body?: unknown, options?: Omit<RestRequestOptions, "body">): Promise<UniversalResponse<T>>;
  put<T = unknown>(url: string, body?: unknown, options?: Omit<RestRequestOptions, "body">): Promise<UniversalResponse<T>>;
  patch<T = unknown>(url: string, body?: unknown, options?: Omit<RestRequestOptions, "body">): Promise<UniversalResponse<T>>;
  delete<T = unknown>(url: string, options?: RestRequestOptions): Promise<UniversalResponse<T>>;
}

declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    rest: RestInput;
    http: RestInput;
  }

  interface HyperProtocols {
    readonly rest: RestClientMethods;
  }
}
