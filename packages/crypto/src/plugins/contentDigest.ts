import type { HyperPlugin } from "@hyperttp/types";
import type { ContentDigestOptions, HttpRequestInput } from "../types/index.js";
import { bodyToBytes, bytesToBase64 } from "../utils/encoding.js";

/**
 * @ru Создаёт HyperTTP-плагин, который добавляет HTTP Content-Digest для тела запроса.
 * @en Creates a HyperTTP plugin that adds an HTTP Content-Digest for the request body.
 *
 * @example
 * client.use(contentDigest({ algorithm: "SHA-512" }));
 *
 * @param options Digest algorithm and header configuration.
 * @returns A HyperTTP request-format plugin.
 */
export function contentDigest(options: ContentDigestOptions = {}): HyperPlugin<HttpRequestInput> {
  return {
    name: "hyperttp-crypto-digest",
    phase: "FORMAT",

    async onRequest(req) {
      if (req.protocol !== "rest") return req;

      const input = req.input;
      if (input.body === undefined || input.body === null) return req;

      const algorithm = options.algorithm ?? "SHA-256";
      const hashBuffer = await crypto.subtle.digest(algorithm, bodyToBytes(input.body));
      const base64Hash = bytesToBase64(new Uint8Array(hashBuffer));

      const headers = new Headers(input.headers);
      headers.set(
        options.headerName ?? "content-digest",
        `${algorithm.toLowerCase()}=:${base64Hash}:`,
      );

      return {
        ...req,
        input: { ...input, headers },
      };
    },
  };
}
