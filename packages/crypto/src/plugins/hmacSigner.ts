import type { HyperPlugin } from "@hyperttp/types";
import { buildCanonicalString } from "../utils/canonical.js";
import { bytesToHex } from "../utils/encoding.js";
import type { HmacSignerOptions, HttpRequestInput } from "../types/index.js";

const encoder = new TextEncoder();

/**
 * @ru Создаёт HyperTTP-плагин, который подписывает каноническое представление запроса через HMAC.
 * @en Creates a HyperTTP plugin that signs the canonical request representation using HMAC.
 *
 * @example
 * client.use(
 *   hmacSigner({
 *     secret: process.env.HMAC_SECRET!,
 *     nonceHeaderName: "x-nonce",
 *     includeHeaders: ["content-digest", "content-type"],
 *   }),
 * );
 *
 * @param options HMAC secret, algorithm, and header configuration.
 * @returns A HyperTTP request-format plugin. Register after body and signed-header transformations.
 */
export function hmacSigner(options: HmacSignerOptions): HyperPlugin<HttpRequestInput> {
  const algorithm = options.algorithm ?? "SHA-256";
  const headerName = options.headerName ?? "x-signature";
  const timestampHeader = options.timestampHeaderName ?? "x-timestamp";
  const nonceHeader = options.nonceHeaderName;

  let cachedCryptoKey: Promise<CryptoKey> | null = null;

  function getCryptoKey(): Promise<CryptoKey> {
    if (!cachedCryptoKey) {
      const keyData =
        typeof options.secret === "string" ? encoder.encode(options.secret) : options.secret;

      cachedCryptoKey = crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: { name: algorithm } },
        false,
        ["sign"],
      );
    }
    return cachedCryptoKey;
  }

  return {
    name: "hyperttp-crypto-hmac",
    phase: "FORMAT",

    async onRequest(req) {
      if (req.protocol !== "rest") return req;

      const timestamp = Date.now().toString();
      const nonce = nonceHeader ? crypto.randomUUID() : undefined;

      const canonicalString = buildCanonicalString({
        url: req.input.url,
        method: req.input.method,
        body: req.input.body,
        timestamp,
        nonce,
        headers: req.input.headers,
        includeHeaders: options.includeHeaders,
      });

      // 3. Вычисление подписи через Web Crypto
      const key = await getCryptoKey();
      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(canonicalString),
      );

      // 4. Мутация заголовков запроса
      const headers = new Headers(req.input.headers);
      headers.set(timestampHeader, timestamp);
      if (nonceHeader && nonce) {
        headers.set(nonceHeader, nonce);
      }

      headers.set(headerName, bytesToHex(new Uint8Array(signatureBuffer)));

      return {
        ...req,
        input: { ...req.input, headers },
      };
    },
  };
}
