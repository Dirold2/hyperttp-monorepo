import type { UniversalResponse } from "@hyperttp/types";
import type { LightweightResponse } from "../types/cache.js";

function cloneValue<T>(value: T): T {
  if (value && typeof value === "object" && !(value instanceof ReadableStream)) {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * @en Creates a cacheable snapshot of a universal response.
 * @ru Создаёт пригодный для кэширования снимок универсального ответа.
 */
export function createResponseSnapshot<T>(response: UniversalResponse<T>): LightweightResponse<T> {
  return {
    protocol: response.protocol,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: { ...response.headers },
    url: response.url,
    data: cloneValue(response.data),
    metadata: response.metadata ? cloneValue({ ...response.metadata }) : undefined,
  };
}

/**
 * @en Reconstructs a universal response from a cached snapshot.
 * @ru Восстанавливает универсальный ответ из снимка кэша.
 */
export function createHttpResponse<T = unknown>(
  snapshot: LightweightResponse<T>,
): UniversalResponse<T> {
  return {
    protocol: snapshot.protocol,
    ok: snapshot.ok,
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: { ...snapshot.headers },
    url: snapshot.url,
    data: cloneValue(snapshot.data),
    metadata: snapshot.metadata ? cloneValue({ ...snapshot.metadata }) : undefined,
  };
}
