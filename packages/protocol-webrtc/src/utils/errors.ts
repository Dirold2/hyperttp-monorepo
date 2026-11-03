export class HyperClientError extends Error {
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

  public static isHyperClientError(err: unknown): err is HyperClientError {
    return (
      err instanceof HyperClientError ||
      (err instanceof Error && (err as any).code === "HYPER_ERROR")
    );
  }
}

export class TimeoutError extends HyperClientError {
  constructor(url: string, timeout: number) {
    super(`Timeout after ${timeout}ms`, "TIMEOUT", 408, undefined, url);
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static isTimeoutError(err: unknown): err is TimeoutError {
    return err instanceof TimeoutError || (err instanceof Error && (err as any).code === "TIMEOUT");
  }
}
