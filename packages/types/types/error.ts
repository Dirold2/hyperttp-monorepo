/**
 * @ru Кастомный тип ошибки для hyperttp с контекстом запроса и ответа.
 * @en Custom error type for hyperttp with request/response context.
 * @template TReq - The protocol-specific shape of the request details.
 * @template TRes - The protocol-specific shape of the response details.
 */
export interface HyperttpError<TReq = unknown, TRes = unknown> extends Error {
  /**
   * @ru Код ошибки, идентифицирующий тип ошибки (например, "TIMEOUT", "NETWORK_ERROR").
   * @en Error code identifying the type of error (e.g., "TIMEOUT", "NETWORK_ERROR").
   */
  code: string;

  /**
   * @ru Оригинальная причина этой ошибки, если доступна.
   * @en The original cause of this error, if available.
   */
  cause?: unknown;

  /**
   * @ru Детали запроса, который привёл к этой ошибке (форма зависит от протокола).
   * @en Request details that led to this error (protocol-specific shape).
   */
  request?: TReq;

  /**
   * @ru Детали ответа, если ответ был получен до возникновения ошибки.
   * @en Response details if a response was received before the error occurred.
   */
  response?: TRes;

  /**
   * @ru Необязательный статус, сообщаемый протоколом или рантаймом.
   * @en Optional status reported by the protocol or runtime.
   */
  status?: number;

  /**
   * @ru Альтернативное поле для необязательного статуса; его синхронизация со `status` не гарантируется.
   * @en Alternative optional status field; synchronization with `status` is not guaranteed.
   */
  statusCode?: number;

  /**
   * @ru Дополнительные метаданные об ошибке и жизненном цикле запроса.
   * @en Additional metadata about the error and request lifecycle.
   */
  meta?: {
    /**
     * @ru Количество попыток повторного запроса до этой ошибки.
     * @en Number of retry attempts made before this error.
     */
    retryCount: number;

    /**
     * @ru Можно ли повторить этот запрос (ошибка восстанавливаемая).
     * @en Whether this error is retryable (can be retried).
     */
    isRetryable: boolean;

    /**
     * @ru Общая длительность запроса в миллисекундах.
     * @en Total request duration in milliseconds.
     */
    duration?: number;

    /**
     * @ru Информация о таймингах жизненного цикла запроса.
     * @en Timing information for the request lifecycle.
     */
    timings?: {
      /**
       * @ru Временная метка начала запроса (Date.now()).
       * @en Request start timestamp (Date.now()).
       */
      start: number;

      /**
       * @ru Временная метка конца запроса (Date.now()), если доступна.
       * @en Request end timestamp (Date.now()), if available.
       */
      end?: number;
    };
  };
}
