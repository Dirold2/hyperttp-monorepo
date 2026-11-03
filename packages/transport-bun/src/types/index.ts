export type Fingerprint = "chrome" | "firefox" | "safari" | "edge";

export interface StealthOptions {
  fingerprint?: Fingerprint;
  ciphers?: string;
}

export interface CacheOptions {
  enabled?: boolean;
  maxSize?: number;
  ttl?: number;
}

/**
 * @ru Конфигурация транспорта Bun.
 * @en Bun transport configuration.
 */
export interface BunTransportConfig {
  /**
   * @ru Базовый URL для всех запросов.
   * @en Base URL for all requests.
   */
  baseUrl?: string;

  /**
   * @ru Параметры скрытности, эмуляции отпечатков TLS (JA3/JA4) и обхода систем DPI.
   * @en Stealth options for TLS fingerprint emulation and DPI evasion strategies.
   */
  stealth?: StealthOptions;

  network?: {
    timeout?: number;
    maxConcurrent?: number;
    keepAliveTimeout?: number;
    rejectUnauthorized?: boolean;
    cache?: CacheOptions;
    cookieCache?: CacheOptions;
  };
}
