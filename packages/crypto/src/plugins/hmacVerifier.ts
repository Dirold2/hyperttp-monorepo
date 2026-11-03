import { buildCanonicalString } from "../utils/canonical.js";
import { bytesToHex } from "../utils/encoding.js";
import { timingSafeEqualHex } from "../utils/timingSafe.js";
import type { HmacVerificationOptions, HttpRequestInput } from "../types/index.js";

const encoder = new TextEncoder();

function isValidHex(value: string): boolean {
  return /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0;
}

/**
 * @ru Проверяет HMAC-подпись запроса и допустимую давность timestamp.
 * @en Verifies an HMAC request signature and timestamp freshness.
 */
export async function verifyHmac(
  request: HttpRequestInput,
  options: HmacVerificationOptions,
): Promise<boolean> {
  const maxAgeMs = options.maxAgeMs ?? 300_000;
  const timestampMs = Number(options.timestamp);
  const now = options.now ?? Date.now();

  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > maxAgeMs) return false;
  if (!isValidHex(options.signature)) return false;

  const canonicalString = buildCanonicalString({
    url: request.url,
    method: request.method,
    body: request.body,
    timestamp: options.timestamp,
    nonce: options.nonce,
    headers: request.headers,
    includeHeaders: options.includeHeaders,
  });
  const keyData =
    typeof options.secret === "string" ? encoder.encode(options.secret) : options.secret;
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: { name: options.algorithm ?? "SHA-256" } },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalString));

  return timingSafeEqualHex(bytesToHex(new Uint8Array(signature)), options.signature.toLowerCase());
}
