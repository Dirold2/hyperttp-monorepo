import { verifyHmac } from "./hmacVerifier.js";
import type { HttpRequestInput, IncomingHmacVerificationOptions } from "../types/index.js";

/**
 * @ru Проверяет HMAC и атомарно использует nonce для предотвращения повторного воспроизведения.
 * @en Verifies HMAC and atomically consumes a nonce to prevent replay.
 */
export async function verifyIncomingRequest(
  request: HttpRequestInput,
  options: IncomingHmacVerificationOptions,
): Promise<boolean> {
  const headers = new Headers(request.headers);
  const headerName = options.headerName ?? "x-signature";
  const timestamp = headers.get(options.timestampHeaderName ?? "x-timestamp");
  const nonce = headers.get(options.nonceHeaderName ?? "x-nonce");
  const signature = headers.get(headerName);
  const maxAgeMs = options.maxAgeMs ?? 300_000;

  if (!timestamp || !nonce || !signature) return false;

  const valid = await verifyHmac(request, {
    secret: options.secret,
    algorithm: options.algorithm,
    includeHeaders: options.includeHeaders,
    timestamp,
    nonce,
    signature,
    maxAgeMs,
    now: options.now,
  });
  if (!valid) return false;

  return options.nonceStore.consume(nonce, maxAgeMs);
}
