import type { TransportRequest } from "@hyperttp/types";

/**
 * @ru Кэш hostname'ов для быстрого извлечения домена из URL.
 * @en Hostname cache for fast domain extraction from URLs.
 */
let hostnameCacheSize = 0;
let hostnameCache: Record<string, string> = Object.create(null);
let lastUrl = "";
let lastHost = "";

/**
 * @ru Быстрое извлечение hostname из URL с кэшированием.
 * @en Fast hostname extraction from URL with caching.
 * @param url - The URL to extract hostname from.
 * @returns The extracted hostname.
 */
export function fastGetHostname(url: string): string {
  if (url === lastUrl) return lastHost;
  if (!url) return "localhost";

  const cached = hostnameCache[url];
  if (cached !== undefined) {
    lastUrl = url;
    lastHost = cached;
    return cached;
  }

  let start = 0;
  const first = url.charCodeAt(0);

  if (first === 47) {
    start = url.charCodeAt(1) === 47 ? 2 : 0;
    if (start === 0) return "localhost";
  } else {
    const schemeIdx = url.indexOf("://");
    if (schemeIdx !== -1) start = schemeIdx + 3;
  }

  let end = url.length;
  for (let i = start; i < end; i++) {
    const code = url.charCodeAt(i);
    if (code === 47 || code === 63 || code === 35) {
      end = i;
      break;
    }
  }

  const atIdx = url.indexOf("@", start);
  if (atIdx !== -1 && atIdx < end) start = atIdx + 1;

  const colonIdx = url.indexOf(":", start);
  if (colonIdx !== -1 && colonIdx < end) end = colonIdx;

  const host = url.slice(start, end) || "localhost";

  if (hostnameCacheSize > 1024) {
    hostnameCache = Object.create(null);
    hostnameCacheSize = 0;
  }

  hostnameCache[url] = host;
  hostnameCacheSize++;
  lastUrl = url;
  lastHost = host;
  return host;
}

/**
 * @ru Разрешает относительный URL относительно baseUrl.
 * @en Resolves a relative URL against a baseUrl.
 * @param baseUrl - The base URL.
 * @param url - The URL to resolve.
 * @returns The resolved absolute URL.
 */
export function resolveUrl(baseUrl: string, url: string): string {
  if (url.charCodeAt(0) === 47) return baseUrl + url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return baseUrl + "/" + url;
}

/**
 * @ru Кэшированные DOMException для частых ошибок abort/timeout.
 * @en Cached DOMException for frequent abort/timeout errors.
 */
export const ABORT_ERROR = new DOMException("The operation was aborted.", "AbortError");
export const TIMEOUT_ERROR = new DOMException(
  "The operation was aborted due to timeout.",
  "TimeoutError",
);

/**
 * @ru Извлекает причину abort из signal или возвращает кэшированную ошибку.
 * @en Extracts abort reason from signal or returns cached error.
 * @param signal - Optional abort signal.
 * @returns The abort error or reason.
 */
export function getAbortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? ABORT_ERROR;
}

export const EMPTY_HEADERS = Object.freeze(Object.create(null)) as Record<string, string>;

/**
 * @ru Нормализует заголовки, переводя все ключи в нижний регистр (lowercase).
 * @en Normalizes headers by transforming all keys into lowercase layout.
 */
export function normalizeHeaders(headers: TransportRequest["headers"]): Record<string, string> {
  if (!headers) return EMPTY_HEADERS;

  if (headers instanceof Headers) {
    let out: Record<string, string> | undefined;
    headers.forEach((value, key) => {
      (out ??= Object.create(null))[key.toLowerCase()] = value;
    });
    return out ?? EMPTY_HEADERS;
  }

  if (Array.isArray(headers)) {
    let out: Record<string, string> | undefined;
    for (let i = 0; i < headers.length; i++) {
      const pair = headers[i] as unknown as [string, string] | undefined;
      if (!pair) continue;
      (out ??= Object.create(null))[pair[0].toLowerCase()] = pair[1];
    }
    return out ?? EMPTY_HEADERS;
  }

  const src = headers as Record<string, unknown>;
  let out: Record<string, string> | undefined;
  for (const key in src) {
    const value = src[key];
    if (value == null) continue;

    const lowerKey = key.toLowerCase();
    const target = out ??= Object.create(null);
    if (Array.isArray(value)) {
      target[lowerKey] = lowerKey === "cookie" ? value.join("; ") : value.join(", ");
      continue;
    }

    target[lowerKey] = String(value);
  }

  return out ?? EMPTY_HEADERS;
}
