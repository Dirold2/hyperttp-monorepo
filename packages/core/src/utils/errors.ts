/**
 * @ru Базовый класс ошибок клиента Hyperttp, агрегирующий контекст неудачного сетевого запроса.
 * @en Base error class for the Hyperttp client, providing explicit layout context for failed requests.
 */
export class HyperClientError extends Error {
  /**
   * @ru Создает ошибку Hyperttp с дополнительным сетевым контекстом.
   * @en Creates a Hyperttp error with optional network context.
   * @param message - Человекочитаемое описание ошибки. @en Human-readable error description.
   * @param code - Машиночитаемый код ошибки. @en Machine-readable error code.
   * @param statusCode - Связанный HTTP-статус, если есть. @en Associated HTTP status, when available.
   * @param originalError - Исходная ошибка как `cause`. @en Original error exposed as `cause`.
   * @param url - URL, связанный с ошибкой. @en URL associated with the error.
   * @param method - HTTP-метод, связанный с ошибкой. @en HTTP method associated with the error.
   */
  constructor(
    message: string,
    public code: string = "HYPER_ERROR",
    public statusCode?: number,
    public originalError?: Error,
    public url?: string,
    public method?: string,
  ) {
    super(message, originalError ? { cause: originalError } : undefined);
    this.name = "HyperClientError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * @ru Проверяет, является ли ошибка экземпляром HyperClientError (безопасно для разрозненных бандлов).
   * @en Checks if an error is a HyperClientError instance (bundle boundary safe).
   */
  public static isHyperClientError(err: unknown): err is HyperClientError {
    return (
      err instanceof HyperClientError ||
      (err instanceof Error && "code" in err && err.code === "HYPER_ERROR")
    );
  }
}

/**
 * @ru Ошибка, возникающая при превышении лимита времени ожидания ответа от сервера.
 * @en Error thrown when a network request exceeds its allocated execution timeout threshold.
 */
export class TimeoutError extends HyperClientError {
  /**
   * @ru Создает ошибку таймаута для указанного URL.
   * @en Creates a timeout error for the given URL.
   * @param url - URL запроса с истекшим таймаутом. @en URL of the timed-out request.
   * @param timeout - Лимит времени в миллисекундах. @en Time limit in milliseconds.
   */
  constructor(url: string, timeout: number) {
    super(`Timeout after ${timeout}ms`, "TIMEOUT", 408, undefined, url);
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * @ru Проверяет, является ли ошибка экземпляром TimeoutError.
   * @en Checks if an error is a TimeoutError instance.
   */
  public static isTimeoutError(err: unknown): err is TimeoutError {
    return (
      err instanceof TimeoutError ||
      (err instanceof Error && "code" in err && err.code === "TIMEOUT")
    );
  }
}
