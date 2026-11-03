import type { ServerRequestContext, UniversalResponse } from "@hyperttp/types";

/**
 * @ru Поддерживаемый HTTP-метод REST-запроса. `QUERY` предназначен для совместимых
 * с ним серверов и прокси.
 * @en Supported HTTP method for a REST request. `QUERY` is intended for servers
 * and proxies that support it.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" | "QUERY";

export type RestHeaders =
  | Headers
  | Record<string, string | number | boolean>
  | ReadonlyArray<readonly [string, string]>;

/**
 * @ru Входные данные REST-запроса, используемые `core.send()` и методами `core.rest`.
 * @en REST request input used by `core.send()` and `core.rest` methods.
 *
 * @example
 * core.send({
 *   protocol: "rest",
 *   input: { method: "POST", url: "https://api.example.test/items", body: { name: "item" } },
 * });
 *
 * @template TBody - Тип тела запроса до сериализации.
 */
export interface RestInput<TBody = unknown> {
  /** @ru HTTP-метод запроса. @en HTTP method for the request. */
  method: HttpMethod;
  /** @ru Абсолютный или относительный URL. @en Absolute or relative URL. */
  url: string;
  /** @ru Заголовки запроса. @en Request headers. */
  headers?: RestHeaders;
  /** @ru Query-параметры, добавляемые к URL. @en Query parameters appended to the URL. */
  query?: Record<string, string | number | boolean | (string | number | boolean)[]>;
  /** @ru Тело запроса; plain object и массив сериализуются в JSON. @en Request body; plain objects and arrays are serialized as JSON. */
  body?: TBody;
  /** @ru Таймаут в миллисекундах. @en Timeout in milliseconds. */
  timeout?: number;
  /** @ru Не буферизовать тело ответа и вернуть поток транспорта. @en Do not buffer the response body and return the transport stream. */
  stream?: boolean;
  /** @ru Отключает автоматические redirect-ы транспорта. @en Disables automatic transport redirects. */
  followRedirects?: boolean;
  /** @ru Максимальное число redirect-ов, если транспорт поддерживает настройку. @en Maximum redirect count when supported by the transport. */
  maxRedirects?: number;
  /** @ru Опция транспорта для stealth-режима. @en Transport-specific stealth mode. */
  stealth?: boolean;
  /** @ru Сигнал отмены запроса. @en Request cancellation signal. */
  signal?: AbortSignal;
}

/**
 * @ru Опции shortcut-методов REST без `method` и `url`.
 * @en REST shortcut-method options excluding `method` and `url`.
 */
export type RestRequestOptions = Omit<RestInput, "method" | "url">;

/**
 * @ru Разобранный серверный REST-запрос, получаемый ресивером из сырого транспорта.
 * @en Parsed server-side REST request produced by the receiver from raw transport input.
 */
export interface RestServerInput {
  readonly method: HttpMethod | (string & {});
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[]>>;
  readonly query: Readonly<Record<string, string | string[]>>;
  readonly body?: unknown;
}

/**
 * @ru Ответ серверного REST-обработчика, сериализуемый ресивером в транспортный формат.
 * @en Server-side REST handler response, serialized by the receiver into the transport format.
 */
export interface RestServerResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

/**
 * @ru Серверный обработчик REST-протокола.
 * @en Server-side REST protocol handler.
 * @param request - The parsed server request.
 * @param ctx - The server request context.
 * @returns The response to serialize.
 */
export type RestServerHandler = (
  request: RestServerInput,
  ctx: ServerRequestContext,
) => RestServerResponse | Promise<RestServerResponse>;

/**
 * @ru Типизированная поверхность shortcut-методов REST, доступная как `core.rest`.
 * @en Typed REST shortcut-method surface available as `core.rest`.
 *
 * @example
 * const response = await core.rest.get<{ id: string }>("https://api.example.test/items/1");
 */
export interface RestClientMethods {
  /** @ru Выполняет GET-запрос. @en Performs a GET request. */
  get<T = unknown>(
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  post<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RestRequestOptions, "body">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  put<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RestRequestOptions, "body">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  patch<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RestRequestOptions, "body">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  delete<T = unknown>(
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  head<T = unknown>(
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  options<T = unknown>(
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  query<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RestRequestOptions, "body">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  request<T = unknown>(
    method: HttpMethod | (string & {}),
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  stream<T = unknown>(
    url: string,
    options?: Omit<RestRequestOptions, "stream">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
}

declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    rest: RestInput;
  }

  interface ProtocolServerRequestMap {
    rest: RestServerInput;
  }

  interface ProtocolServerResponseMap {
    rest: RestServerResponse;
  }

  interface HyperProtocols {
    readonly rest: RestClientMethods;
  }
}
