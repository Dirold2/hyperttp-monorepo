/**
 * @ru Опции логики повторных попыток запроса.
 * @en Retry logic options.
 */
export interface RetryOptions {
  /**
   * @ru Максимальное количество повторных попыток.
   * @en Maximum number of retries.
   */
  maxRetries?: number;

  /**
   * @ru Базовая задержка перед повторной попыткой в миллисекундах.
   * @en Base delay before a retry in milliseconds.
   */
  baseDelay?: number;

  /**
   * @ru Максимальная задержка между повторными попытками в миллисекундах.
   * @en Maximum delay between retries in milliseconds.
   */
  maxDelay?: number;

  /**
   * @ru Добавлять ли случайный джиттер к задержке.
   * @en Whether to add random jitter to the delay.
   */
  jitter?: boolean;
}
