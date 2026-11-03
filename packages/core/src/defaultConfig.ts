import type { HyperClientOptions } from "@hyperttp/types";

/**
 * @ru Конфигурация по умолчанию универсального ядра.
 * @en Default configuration for the universal core.
 */
export const defaultCoreConfig: HyperClientOptions = {
  retry: {
    maxRetries: 0,
    baseDelay: 100,
    maxDelay: 5000,
    jitter: true,
  },
  verbose: false,
};
