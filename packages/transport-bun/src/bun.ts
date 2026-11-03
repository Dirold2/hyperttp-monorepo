import type {
  HyperTransport,
  TransportListenOptions,
  TransportRequest,
  TransportResponse,
  TransportServer,
} from "@hyperttp/types";
import type { BunTransportConfig, Fingerprint, StealthOptions } from "./types/index.js";
import {
  fastGetHostname,
  getAbortError,
  EMPTY_HEADERS,
  normalizeHeaders,
  resolveUrl,
  TIMEOUT_ERROR,
} from "./utils/helpers.js";
import { CacheManager } from "hcacher";

/**
 * @ru Статические пресеты браузерных заголовков для маскировки под реальных пользователей.
 * Используются stealth-режимом для обхода fingerprint-защит.
 * @en Static presets of browser headers for masking as real users.
 * Used by stealth mode to bypass fingerprint protections.
 */
const STEALTH_HEADER_PRESETS: Record<string, Record<string, string>> = {
  chrome: {
    "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "accept-language": "en-US,en;q=0.9",
  },
  firefox: {
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "accept-language": "en-US,en;q=0.5",
    "upgrade-insecure-requests": "1",
  },
};

/**
 * @ru Пресеты User-Agent, соответствующие TLS-отпечаткам (JA3/JA4).
 * @en User-Agent presets matching the TLS fingerprints (JA3/JA4).
 */
const STEALTH_UA_PRESETS: Record<string, string> = {
  chrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (X11; Linux; rv:126.0) Gecko/20100101 Firefox/126.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  edge: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
};

/**
 * @ru Возвращает строку шифров TLS для указанного профиля браузера.
 * @en Returns the TLS cipher suite string for the specified browser profile.
 * @param fingerprint - Browser fingerprint profile.
 * @returns Colon-separated cipher suite string, or empty string if not found.
 */
function getCiphersForProfile(fingerprint: Fingerprint | undefined): string {
  if (!fingerprint) return "";

  switch (fingerprint) {
    case "chrome":
    case "edge":
      return [
        "TLS_AES_128_GCM_SHA256",
        "TLS_AES_256_GCM_SHA384",
        "TLS_CHACHA20_POLY1305_SHA256",
        "ECDHE-ECDSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES128-GCM-SHA256",
      ].join(":");

    case "firefox":
      return [
        "TLS_AES_128_GCM_SHA256",
        "TLS_CHACHA20_POLY1305_SHA256",
        "TLS_AES_256_GCM_SHA384",
        "ECDHE-ECDSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES128-GCM-SHA256",
      ].join(":");

    case "safari":
      return [
        "TLS_AES_256_GCM_SHA384",
        "TLS_CHACHA20_POLY1305_SHA256",
        "TLS_AES_128_GCM_SHA256",
        "ECDHE-ECDSA-AES256-GCM-SHA384",
        "ECDHE-RSA-AES256-GCM-SHA384",
      ].join(":");

    default:
      return "";
  }
}

/**
 * @ru Безопасно применяет стелс-пресеты, отдавая абсолютный приоритет ручным заголовкам.
 * @en Safely applies stealth presets, giving absolute priority to manual headers.
 * @param headers - The headers object to modify.
 * @param stealth - Stealth configuration options.
 * @returns The modified headers object.
 */
function applyStealthHeaders(
  headers: Record<string, string>,
  stealth: StealthOptions,
): Record<string, string> {
  if (!stealth || !stealth.fingerprint) return headers;

  const presetName = stealth.fingerprint;
  const presetHeaders = STEALTH_HEADER_PRESETS[presetName];

  if (presetHeaders) {
    for (const key in presetHeaders) {
      if (headers[key] === undefined) {
        headers[key] = presetHeaders[key]!;
      }
    }
  }

  const currentUA = headers["user-agent"];
  if (currentUA === undefined || currentUA === "hyperttp/2.0" || currentUA === "Hyperttp/2.0") {
    const browserUA = STEALTH_UA_PRESETS[presetName];
    if (browserUA) {
      headers["user-agent"] = browserUA;
    }
  }

  return headers;
}

/**
 * @ru Высокопроизводительный HTTP-транспорт для Bun с нативными оптимизациями и поддержкой Stealth-мимикрии.
 * Включает управление параллелизмом, cookie jar и кэширование доменов.
 * @en High-performance HTTP transport for Bun with native optimizations and Stealth mimicry support.
 * Includes concurrency management, cookie jar, and domain caching.
 */
export class BunTransport implements HyperTransport {
  public readonly protocols = ["rest"] as const;

  public supports(protocol: string): boolean {
    return protocol === "rest";
  }

  /**
   * @ru Конфигурация транспорта.
   * @en Transport configuration.
   */
  public config: BunTransportConfig;

  private readonly servers = new Set<(force?: boolean) => Promise<void>>();

  /**
   * @ru Кэш cookies по доменам с TTL и LRU-эвикцией (domain -> name -> value).
   * @en Cookie cache by domain with TTL and LRU eviction (domain -> name -> value).
   */
  private readonly cookieStore: CacheManager<Record<string, string>>;

  /**
   * @ru Кэш сгенерированных строк cookies с TTL.
   * @en Cache of generated cookie strings with TTL.
   */
  private readonly cookieStringCache: CacheManager<string>;

  /**
   * @ru Наличие cookies в jar. Пока сервер не установил cookie, полностью пропускаем cookie hot path.
   * @en Whether the jar contains cookies. Skip the cookie hot path until a server sets one.
   */
  private hasCookies = false;

  /**
   * @ru Включено ли cookie-хранилище. При отключении исключаем cookie work из hot path.
   * @en Whether the cookie store is enabled. When disabled, skip cookie work in the hot path.
   */
  private readonly cookiesEnabled: boolean;

  /**
   * @ru Опциональный кэш HTTP-ответов для GET/HEAD запросов.
   * @en Optional HTTP response cache for GET/HEAD requests.
   */
  private readonly responseCache?: CacheManager<TransportResponse>;

  /**
   * @ru Счётчик активных (выполняющихся) запросов.
   * @en Counter of active (in-flight) requests.
   */
  private activeRequests = 0;

  /**
   * @ru Очередь запросов, ожидающих свободного слота при достижении лимита параллелизма.
   * @en Queue of requests waiting for a free slot when concurrency limit is reached.
   */
  private concurrencyQueue: Record<number, () => void> = Object.create(null);

  /**
   * @ru Индекс начала очереди (для FIFO обработки).
   * @en Queue head index (for FIFO processing).
   */
  private queueHead = 0;

  /**
   * @ru Индекс конца очереди (для добавления новых элементов).
   * @en Queue tail index (for adding new elements).
   */
  private queueTail = 0;

  /**
   * @ru Максимальное количество одновременных запросов (0 = без лимита).
   * @en Maximum number of concurrent requests (0 = unlimited).
   */
  private _maxConcurrent = 0;

  /**
   * @ru Таймаут запроса в миллисекундах (0 = без таймаута).
   * @en Request timeout in milliseconds (0 = no timeout).
   */
  private _timeout = 0;

  /**
   * @ru Флаг использования keep-alive соединений.
   * @en Flag for using keep-alive connections.
   */
  private _keepalive = false;

  /**
   * @ru Конфигурация TLS (отклонение невалидных сертификатов и шифры).
   * @en TLS configuration (reject unauthorized certificates and ciphers).
   */
  private _tlsConfig: { rejectUnauthorized: boolean; ciphers?: string } | null = null;

  /**
   * @ru Создаёт экземпляр BunTransport.
   * @en Creates a BunTransport instance.
   * @param config - Transport configuration.
   */
  constructor(config: BunTransportConfig) {
    this.config = config;

    const cookieCfg = config?.network?.cookieCache;
    this.cookiesEnabled = cookieCfg?.enabled ?? true;
    this.cookieStore = new CacheManager<Record<string, string>>({
      enabled: this.cookiesEnabled,
      maxSize: cookieCfg?.maxSize ?? 256,
      ttl: cookieCfg?.ttl ?? 300_000,
      touchOnGet: true,
    });

    this.cookieStringCache = new CacheManager<string>({
      enabled: this.cookiesEnabled,
      maxSize: cookieCfg?.maxSize ?? 1024,
      ttl: cookieCfg?.ttl ?? 60_000,
      touchOnGet: true,
    });

    const cacheCfg = config?.network?.cache;
    if (cacheCfg?.enabled !== false && (cacheCfg?.maxSize || cacheCfg?.ttl)) {
      this.responseCache = new CacheManager<TransportResponse>({
        enabled: cacheCfg?.enabled ?? true,
        maxSize: cacheCfg?.maxSize ?? 256,
        ttl: cacheCfg?.ttl ?? 30_000,
        touchOnGet: true,
      });
    }

    this.invalidateConfig();
  }

  /**
   * @ru Принимает HTTP-запросы через Bun.serve без разбора тела.
   * @en Accepts HTTP requests through Bun.serve without parsing the body.
   */
  public async listen(options: TransportListenOptions): Promise<TransportServer> {
    const { signal, onRequest } = options;
    if (signal?.aborted) throw getAbortError(signal);

    const server = Bun.serve({
      hostname: options.host,
      port: options.port,
      fetch: async (request) => {
        if (!onRequest) return new Response(null, { status: 503 });

        const response = await onRequest({
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers),
          body: request.body,
          signal: request.signal,
          protocol: "rest",
        });
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) headers.append(name, item);
          } else {
            headers.set(name, value);
          }
        }

        return new Response(response.body as BodyInit | null | undefined, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      },
    });

    const stop = async (force = false): Promise<void> => {
      try {
        await server.stop(force);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        this.servers.delete(stop);
      }
    };
    const onAbort = (): void => {
      void stop(true).catch(() => {});
    };
    this.servers.add(stop);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      await stop(true);
      throw getAbortError(signal);
    }

    return { close: () => stop() };
  }

  /**
   * @ru Обновляет внутреннее состояние на основе конфигурации.
   * Вызывается при создании и может быть вызвано при изменении конфига.
   * @en Updates internal state based on configuration.
   * Called on creation and can be called when config changes.
   */
  private invalidateConfig(): void {
    const net = this.config?.network;
    this._maxConcurrent = net?.maxConcurrent ?? 0;
    this._timeout = net?.timeout ?? 0;
    this._keepalive = !!net?.keepAliveTimeout;
    this._tlsConfig = (net?.rejectUnauthorized ?? true) ? null : { rejectUnauthorized: false };
  }

  /**
   * @ru Выполняет HTTP-запрос через нативный fetch Bun с управлением параллелизмом и таймаутами.
   * @en Executes an HTTP request via Bun's native fetch with concurrency management and timeouts.
   * @param req - The normalized transport request.
   * @returns Promise resolving to the transport response.
   * @throws Error if the request is aborted or times out.
   */
  public async execute(
    req: TransportRequest & { stealth?: StealthOptions; stream?: boolean },
  ): Promise<TransportResponse> {
    const maxConcurrent = this._maxConcurrent;
    const timeoutMs = this._timeout;

    let signal = req.signal;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;
    let originalSignal: AbortSignal | null = null;

    if (timeoutMs > 0) {
      if (!signal) {
        signal = AbortSignal.timeout(timeoutMs);
      } else if (signal.aborted) {
        throw getAbortError(signal);
      } else {
        const controller = new AbortController();
        originalSignal = signal;

        abortHandler = () => controller.abort(originalSignal!.reason);
        originalSignal.addEventListener("abort", abortHandler);
        timer = setTimeout(() => controller.abort(TIMEOUT_ERROR), timeoutMs);
        signal = controller.signal;
      }
    }

    if (signal?.aborted) {
      if (timer !== null) clearTimeout(timer);
      if (originalSignal && abortHandler) originalSignal.removeEventListener("abort", abortHandler);
      throw getAbortError(signal);
    }

    if (maxConcurrent > 0 && this.activeRequests >= maxConcurrent) {
      try {
        await this.waitForSlot(signal);
      } catch (err) {
        if (timer !== null) clearTimeout(timer);
        if (originalSignal && abortHandler)
          originalSignal.removeEventListener("abort", abortHandler);
        throw err;
      }
      if (signal?.aborted) {
        if (timer !== null) clearTimeout(timer);
        if (originalSignal && abortHandler)
          originalSignal.removeEventListener("abort", abortHandler);
        throw getAbortError(signal);
      }
    }

    this.activeRequests++;

    try {
      const fullUrl = resolveUrl(this.config?.baseUrl ?? "", req.url);

      if (
        this.responseCache &&
        !req.stream &&
        (req.method === "GET" || req.method === "HEAD") &&
        !req.body
      ) {
        const cacheKey = `${req.method}:${fullUrl}`;
        const cached = this.responseCache.get(cacheKey);
        if (cached !== undefined) {
          return cached;
        }
      }

      let headers = normalizeHeaders(req.headers) as Record<string, string>;

      if (this.hasCookies) {
        const activeCookies = this.getCookiesForDomain(fastGetHostname(fullUrl));
        if (activeCookies.length > 0) {
          if (headers === EMPTY_HEADERS) headers = Object.create(null);
          headers["cookie"] = headers["cookie"]
            ? headers["cookie"] + "; " + activeCookies
            : activeCookies;
        }
      }

      const stealth =
        req.stealth || this.config.stealth ? { ...this.config.stealth, ...req.stealth } : undefined;

      if (stealth) {
        if (headers === EMPTY_HEADERS) headers = Object.create(null);
        headers = applyStealthHeaders(headers, stealth);
      }

      const init: RequestInit & { tls?: unknown } = {
        method: req.method,
        redirect: (req as any).redirect ?? "manual",
      };
      if (headers !== EMPTY_HEADERS) init.headers = headers as HeadersInit;

      if (req.body !== undefined) init.body = req.body as BodyInit;
      if (signal !== undefined) init.signal = signal;
      if (this._keepalive) init.keepalive = true;

      let requestTlsConfig = this._tlsConfig;
      if (stealth?.ciphers || stealth?.fingerprint) {
        const ciphers = stealth.ciphers ?? getCiphersForProfile(stealth.fingerprint);
        if (ciphers) {
          requestTlsConfig = requestTlsConfig
            ? { ...requestTlsConfig, ciphers }
            : { rejectUnauthorized: true, ciphers };
        }
      }
      if (requestTlsConfig !== null) init.tls = requestTlsConfig;

      const nativeRes = await fetch(fullUrl, init);

      this.storeCookies(fullUrl, nativeRes.headers);

      const bodyStream = nativeRes.body;

      const responseHeaders: Record<string, string | string[]> = Object.create(null);
      nativeRes.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const response: TransportResponse = {
        status: nativeRes.status,
        url: nativeRes.url,
        body: bodyStream,
        headers: responseHeaders,
      };

      if (
        this.responseCache &&
        !req.stream &&
        (req.method === "GET" || req.method === "HEAD") &&
        !req.body &&
        bodyStream === null
      ) {
        const cacheKey = `${req.method}:${fullUrl}`;
        this.responseCache.set(cacheKey, response);
      }

      return response;
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (originalSignal && abortHandler) {
        originalSignal.removeEventListener("abort", abortHandler);
      }
      this.activeRequests--;
      if (maxConcurrent > 0) this.releaseSlot();
    }
  }

  /**
   * @ru Получает строку cookies для указанного домена с учётом родительских доменов.
   * @en Gets the cookie string for the specified domain, considering parent domains.
   * @param requestDomain - The domain to get cookies for.
   * @returns Semicolon-separated cookie string.
   */
  private getCookiesForDomain(requestDomain: string): string {
    const cached = this.cookieStringCache.get(requestDomain);
    if (cached !== undefined) return cached;

    let result = "";
    const domains = this.cookieStore.size > 0 ? this.getAllCookieDomains() : [];

    for (let i = 0; i < domains.length; i++) {
      const storedDomain = domains[i]!;
      if (requestDomain !== storedDomain && !requestDomain.endsWith("." + storedDomain)) continue;

      const cookiesMap = this.cookieStore.get(storedDomain);
      if (!cookiesMap) continue;

      for (const key in cookiesMap) {
        if (result.length > 0) result += "; ";
        result += key + "=" + cookiesMap[key];
      }
    }

    this.cookieStringCache.set(requestDomain, result);
    return result;
  }

  /**
   * @ru Возвращает все домены из cookie store.
   * @en Returns all domains from the cookie store.
   */
  private getAllCookieDomains(): string[] {
    const domains: string[] = [];
    const store = (this.cookieStore as any).storage as Map<string, unknown>;
    for (const key of store.keys()) {
      domains.push(key);
    }
    return domains;
  }

  /**
   * @ru Сохраняет cookies из заголовков Set-Cookie ответа в cookie jar.
   * @en Stores cookies from response Set-Cookie headers into the cookie jar.
   * @param requestUrl - The request URL for determining the default domain.
   * @param headers - Response headers containing Set-Cookie values.
   */
  private storeCookies(requestUrl: string, headers: Headers): void {
    if (!this.cookiesEnabled || typeof headers.getSetCookie !== "function") return;

    const setCookies = headers.getSetCookie();
    if (setCookies.length === 0) return;

    const defaultDomain = fastGetHostname(requestUrl);

    for (let i = 0; i < setCookies.length; i++) {
      const rawCookie = setCookies[i];
      if (!rawCookie) continue;

      const firstSemicolon = rawCookie.indexOf(";");
      const mainPair = firstSemicolon === -1 ? rawCookie : rawCookie.slice(0, firstSemicolon);

      const eqIdx = mainPair.indexOf("=");
      if (eqIdx === -1) continue;

      const name = mainPair.slice(0, eqIdx).trim();
      const value = mainPair.slice(eqIdx + 1).trim();
      if (!name) continue;

      let domain = defaultDomain;

      if (firstSemicolon !== -1) {
        const parts = rawCookie.split(";");
        for (let j = 1; j < parts.length; j++) {
          const part = parts[j]!.trim();
          if (part.length > 7 && part.toLowerCase().startsWith("domain=")) {
            const rawDomain = part.slice(7).trim();
            if (rawDomain) {
              domain = rawDomain.charCodeAt(0) === 46 ? rawDomain.slice(1) : rawDomain;
            }
            break;
          }
        }
      }

      const existing = this.cookieStore.get(domain) ?? Object.create(null);
      existing[name] = value;
      this.cookieStore.set(domain, existing);
      this.hasCookies = true;

      this.cookieStringCache.delete(domain);
    }
  }

  /**
   * @ru Ожидает освобождения слота в очереди параллелизма.
   * @en Waits for a slot to become available in the concurrency queue.
   * @param signal - Optional abort signal to cancel waiting.
   * @returns Promise that resolves when a slot is available.
   * @throws Error if the signal is aborted while waiting.
   */
  private async waitForSlot(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const currentTail = this.queueTail++;

      const onAbort = () => {
        signal?.removeEventListener("abort", onAbort);
        delete this.concurrencyQueue[currentTail];
        reject(getAbortError(signal));
      };

      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      this.concurrencyQueue[currentTail] = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
    });
  }

  /**
   * @ru Освобождает слот и разблокирует следующий запрос в очереди.
   * @en Releases a slot and unblocks the next request in the queue.
   */
  private releaseSlot(): void {
    while (this.queueHead < this.queueTail) {
      const next = this.concurrencyQueue[this.queueHead];
      if (next !== undefined) {
        delete this.concurrencyQueue[this.queueHead];
        this.queueHead++;
        next();
        return;
      }
      this.queueHead++;
    }

    if (this.queueHead === this.queueTail) {
      this.queueHead = 0;
      this.queueTail = 0;
    }
  }

  /**
   * @ru Мягко закрывает транспорт, очищая очереди и cookie jar.
   * @en Gracefully closes the transport, clearing queues and cookie jar.
   * @returns Promise that resolves when cleanup is complete.
   */
  public async close(): Promise<void> {
    await Promise.all(Array.from(this.servers, (stop) => stop()));
    this.concurrencyQueue = Object.create(null);
    this.queueHead = 0;
    this.queueTail = 0;
    this.cookieStore.clear();
    this.cookieStringCache.clear();
    this.hasCookies = false;
    this.responseCache?.clear();
    this.activeRequests = 0;
  }

  /**
   * @ru Принудительно останавливает серверы и освобождает ресурсы транспорта.
   * @en Forcefully stops servers and releases transport resources.
   * @returns Promise that resolves when cleanup is complete.
   */
  public async destroy(): Promise<void> {
    await Promise.all(Array.from(this.servers, (stop) => stop(true)));
    await this.close();
  }
}
