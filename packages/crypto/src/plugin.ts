import type { HyperPlugin, PluginOnRequestResult, SendRequest } from "@hyperttp/types";
import { contentDigest } from "./plugins/contentDigest.js";
import { hmacSigner } from "./plugins/hmacSigner.js";
import type { HttpRequestInput, WithCryptoOptions } from "./types/index.js";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    crypto?: WithCryptoOptions;
  }
}

/**
 * @ru Проверяет, что вход плагина содержит минимальные данные HTTP-запроса для криптографической обработки.
 * @en Checks whether the plugin input contains the minimum HTTP request data for cryptographic processing.
 */
function isCryptoRequest(request: SendRequest<unknown>): boolean {
  const input = request.input;
  return (
    request.protocol === "rest" &&
    typeof input === "object" &&
    input !== null &&
    "url" in input &&
    typeof input.url === "string" &&
    "method" in input &&
    typeof input.method === "string"
  );
}

/**
 * @ru Адаптирует строго типизированный результат криптографического плагина к базовому контракту HyperTTP.
 * @en Adapts a strictly typed crypto-plugin result to the base HyperTTP contract.
 */
function asPluginResult(result: PluginOnRequestResult<HttpRequestInput>): PluginOnRequestResult {
  return result as PluginOnRequestResult;
}

/**
 * @ru Объединяет генерацию Content-Digest и опциональную HMAC-подпись в один
 * HyperTTP-плагин. Без параметров добавляет только заголовок Content-Digest с SHA-256:
 * HMAC включается исключительно при явной передаче секрета.
 * @en Combines Content-Digest generation and optional HMAC signing into one
 * HyperTTP plugin. Without options it adds only a SHA-256 Content-Digest header:
 * HMAC is enabled only when a secret is explicitly provided.
 *
 * @example
 * client.use(withCrypto());
 *
 * @example
 * client.use(
 *   withCrypto({
 *     hmac: {
 *       secret: process.env.HMAC_SECRET!,
 *       nonceHeaderName: "x-nonce",
 *       includeHeaders: ["content-digest", "content-type"],
 *     },
 *   }),
 * );
 *
 * @param options Plugin configuration for Digest generation and HMAC signing.
 * @returns A single HyperTTP plugin that calculates Digest before signing.
 */
export function withCrypto(options?: WithCryptoOptions): HyperPlugin {
  const defaultOptions: WithCryptoOptions = {};
  let configuredOptions: WithCryptoOptions | undefined;
  let digestPlugin: ReturnType<typeof contentDigest> | undefined;
  let hmacPlugin: ReturnType<typeof hmacSigner> | undefined;

  function configure(nextOptions: WithCryptoOptions): void {
    if (configuredOptions === nextOptions) return;

    configuredOptions = nextOptions;
    digestPlugin = nextOptions.digest === false ? undefined : contentDigest(nextOptions.digest);
    hmacPlugin = nextOptions.hmac ? hmacSigner(nextOptions.hmac) : undefined;
  }

  return {
    name: "hyperttp-crypto",
    phase: "FORMAT",
    setup(context) {
      configure(options ?? context.config.crypto ?? defaultOptions);
    },
    async onRequest(request, context, requestContext) {
      if (!isCryptoRequest(request)) return request;

      configure(options ?? context?.config.crypto ?? defaultOptions);
      const cryptoRequest = request as unknown as SendRequest<HttpRequestInput>;
      const digested = digestPlugin?.onRequest
        ? await digestPlugin.onRequest(cryptoRequest, context, requestContext)
        : cryptoRequest;
      if (!digested || !("input" in digested) || !hmacPlugin?.onRequest) {
        return asPluginResult(digested);
      }

      return asPluginResult(await hmacPlugin.onRequest(digested, context, requestContext));
    },
  };
}
