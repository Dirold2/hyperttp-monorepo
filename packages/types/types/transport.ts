import type { HyperProtocolName } from "./protocol.js";

/**
 * @ru Запрос, выполняемый транспортом: минимальный сетевой конверт с методом, URL, заголовками, телом и контекстом выполнения.
 * @en Request executed by a transport: a minimal network envelope with method, URL, headers, body, and execution context.
 */
export interface TransportRequest {
  /**
   * @ru HTTP-метод (GET, POST и т.д.).
   * @en HTTP method (GET, POST, etc.).
   */
  readonly method: string;

  /**
   * @ru Полный целевой URL.
   * @en Full target URL.
   */
  readonly url: string;

  /**
   * @ru Заголовки запроса.
   * @en Request headers.
   */
  readonly headers: Readonly<Record<string, string | string[]>>;

  /**
   * @ru Тело запроса.
   * @en Request body.
   */
  readonly body?: unknown;

  /**
   * @ru Сигнал прерывания для отмены операции.
   * @en Abort signal to cancel the operation.
   */
  readonly signal?: AbortSignal;

  /**
   * @ru Идентификатор протокола, от имени которого выполняется запрос.
   * @en Protocol identifier on behalf of which the request is executed.
   */
  readonly protocol: HyperProtocolName;

  /** Whether the transport should expose the response as a stream when supported. */
  readonly stream?: boolean;

  /** Whether redirects should be followed when supported by the transport. */
  readonly followRedirects?: boolean;

  /** Maximum number of redirects when redirect following is enabled. */
  readonly maxRedirects?: number;
}

/**
 * @ru Сырой ответ транспорта: статус, заголовки и тело.
 * @en Raw transport response: status, headers, and body.
 */
export interface TransportResponse {
  /**
   * @ru Числовой код статуса ответа.
   * @en Numeric response status code.
   */
  readonly status: number;

  /**
   * @ru Текстовое описание статуса.
   * @en Status text associated with the status code.
   */
  readonly statusText?: string;

  /**
   * @ru Заголовки ответа.
   * @en Response headers.
   */
  readonly headers: Readonly<Record<string, string | string[]>>;

  /**
   * @ru Финальный URL ответа.
   * @en Final response URL.
   */
  readonly url?: string;

  /**
   * @ru Сырое тело ответа (ReadableStream, Buffer или другой формат рантайма).
   * @en Raw response body (ReadableStream, Buffer, or another runtime format).
   */
  readonly body: unknown;
}

export interface TransportListenOptions {
  readonly host?: string;
  readonly port?: number;
  readonly signal?: AbortSignal;

  /**
   * @ru Колбэк доставки входящих запросов. Транспорт не знает о протоколах: это сырой ввод/вывод.
   * Ядро оборачивает ресивер в этот колбэк. Если колбэк не передан, входящие запросы отклоняются.
   * @en Callback delivering incoming requests. The transport knows nothing about protocols: this is raw I/O.
   * The core wraps a receiver into this callback. If omitted, incoming requests are rejected.
   * @param request - The raw incoming transport request.
   * @returns The raw transport response.
   */
  readonly onRequest?: (
    request: TransportRequest,
  ) => Promise<TransportResponse> | TransportResponse;
}

export interface TransportServer {
  /**
   * @ru Мягко останавливает сервер, дожидаясь незавершённых запросов.
   * @en Gracefully stops the server, waiting for pending requests.
   */
  close(): Promise<void> | void;
}

/**
 * @ru Транспорт — «тупой» слой сетевого ввода/вывода. Не знает про семантику протоколов и не парсит тело.
 * @en Transport — a "dumb" network I/O layer. It knows nothing about protocol semantics and does not parse bodies.
 */
export interface HyperTransport {
  /**
   * @ru Список протоколов, поддерживаемых транспортом.
   * @en List of protocols supported by the transport.
   */
  readonly protocols?: readonly HyperProtocolName[];

  /**
   * @ru Проверяет поддержку протокола транспортом.
   * @en Checks whether the transport supports a protocol.
   * @param protocol - The protocol identifier.
   * @returns true if the protocol is supported.
   */
  supports?(protocol: HyperProtocolName): boolean;

  /**
   * @ru Выполняет запрос и возвращает сырой ответ.
   * @en Executes the request and returns the raw response.
   * @param request - The request to execute.
   * @returns A promise resolving to the raw transport response.
   */
  execute(request: TransportRequest): Promise<TransportResponse>;

  /**
   * @ru Серверная операция транспорта, запускающая приём входящих запросов или сообщений.
   * @en Server-side transport operation that starts listening for incoming requests or messages.
   */
  listen?(options: TransportListenOptions): Promise<TransportServer>;

  /**
   * @ru Мягко закрывает транспорт, дожидаясь незавершённых операций.
   * @en Gracefully closes the transport, waiting for pending operations.
   * If both `close` and `destroy` are available, graceful shutdown prefers `close`.
   */
  close?(): Promise<void> | void;

  /**
   * @ru Немедленно уничтожает транспорт и освобождает ресурсы.
   * @en Immediately destroys the transport and releases resources.
   * If both `destroy` and `close` are available, forced shutdown prefers `destroy`.
   */
  destroy?(): Promise<void> | void;
}
