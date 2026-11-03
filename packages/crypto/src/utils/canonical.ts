import type { CanonicalOptions } from "../types/index.js";
import { bodyToBytes, bytesToBase64 } from "./encoding.js";

export type { CanonicalOptions } from "../types/index.js";

/**
 * @ru Создаёт версионированную детерминированную HMAC-строку из точных байтов тела запроса.
 * @en Builds a versioned, deterministic HMAC payload from the exact request body bytes.
 */
export function buildCanonicalString(options: CanonicalOptions): string {
  if (!options.method) throw new TypeError("A request method is required for HMAC signing");
  if (!options.timestamp) throw new TypeError("A timestamp is required for HMAC signing");

  const url = new URL(options.url);
  const headers = new Headers(options.headers);
  const includedHeaders = options.includeHeaders ?? [];
  const headerLines = includedHeaders.map(
    (name) => `${name.toLowerCase()}:${headers.get(name) ?? ""}`,
  );

  return [
    "hyperttp-hmac-v1",
    options.method.toUpperCase(),
    url.origin,
    `${url.pathname}${url.search}`,
    options.timestamp,
    options.nonce ?? "",
    bytesToBase64(bodyToBytes(options.body)),
    ...headerLines,
  ].join("\n");
}
