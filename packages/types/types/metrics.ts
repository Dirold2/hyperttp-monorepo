import type { HyperPlugin } from "./plugin.js";

/**
 * @ru Объект метрик и внутренней статистики ядра.
 * @en Object with metrics and internal core statistics.
 */
export interface HyperStats {
  /**
   * @ru Текущее количество активных запросов в полёте.
   * @en Current number of in-flight requests.
   */
  inflightRequests?: number;

  /**
   * @ru Текущий размер кэша (количество записей).
   * @en Current cache size (number of entries).
   */
  cacheSize?: number;

  /**
   * @ru Количество запросов, ожидающих в очереди отправки.
   * @en Number of requests queued for dispatch.
   */
  queuedRequests?: number;

  /**
   * @ru Количество активных очередей или воркеров обработки.
   * @en Number of active processing queues or workers.
   */
  activeQueue?: number;

  /**
   * @ru Суммарное количество срабатываний лимитера частоты запросов.
   * @en Total count of rate limiter restriction hits.
   */
  rateLimitHits?: number;

  /**
   * @ru Любые динамические кастомные метрики от пользовательских модулей.
   * @en Arbitrary dynamic metrics added by custom modules.
   */
  [key: string]: unknown;
}

/**
 * @ru Метрики отдельного запроса, собираемые на протяжении его жизненного цикла.
 * @en Metrics of a single request collected across its lifecycle.
 */
export interface RequestMetrics {
  /**
   * @ru Временная метка начала запроса.
   * @en Request start timestamp.
   */
  startTime: number;

  /**
   * @ru Временная метка конца запроса.
   * @en Request end timestamp.
   */
  endTime: number;

  /**
   * @ru Общая длительность запроса в миллисекундах.
   * @en Total request duration in milliseconds.
   */
  duration: number;

  /**
   * @ru Количество полученных байт.
   * @en Number of bytes received.
   */
  bytesReceived: number;

  /**
   * @ru Количество отправленных байт.
   * @en Number of bytes sent.
   */
  bytesSent: number;

  /**
   * @ru Количество выполненных повторных попыток.
   * @en Number of retries performed.
   */
  retries: number;

  /**
   * @ru Был ли ответ взят из кэша.
   * @en Whether the response was served from cache.
   */
  cached: boolean;

  /**
   * @ru Числовой код статуса ответа.
   * @en Numeric response status code.
   */
  statusCode?: number;

  /**
   * @ru URL запроса.
   * @en Request URL.
   */
  url?: string;

  /**
   * @ru Метод или имя операции запроса.
   * @en Request method or operation name.
   */
  method?: string;

  /**
   * @ru Хэш тела запроса.
   * @en Hash of the request body.
   */
  bodyHash?: string;

  /**
   * @ru Карта плагинов, участвовавших в обработке запроса.
   * @en Map of plugins that participated in request processing.
   */
  plugins?: Map<string, HyperPlugin>;

  /**
   * @ru Тайминги отдельных фаз запроса.
   * @en Timings of individual request stages.
   */
  stages?: {
    /**
     * @ru Время сериализации в миллисекундах.
     * @en Serialization time in milliseconds.
     */
    serializationMs?: number;

    /**
     * @ru Время сетевого взаимодействия в миллисекундах.
     * @en Network time in milliseconds.
     */
    networkMs?: number;

    /**
     * @ru Время парсинга в миллисекундах.
     * @en Parsing time in milliseconds.
     */
    parsingMs?: number;
  };
}
