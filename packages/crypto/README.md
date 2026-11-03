# @hyperttp/crypto

[Русский](./lang/ru/README.md)

Cryptographic plugins for [HyperTTP](https://github.com/dirold2/hyperttp): HTTP Content-Digest, HMAC request signing, signature verification, and replay protection.

## Installation

```bash
npm install @hyperttp/crypto @hyperttp/types
```

## Quick start

```ts
import { withCrypto } from "@hyperttp/crypto";

client.use(
  withCrypto({
    hmac: {
      secret: process.env.HMAC_SECRET!,
      nonceHeaderName: "x-nonce",
      includeHeaders: ["content-digest", "content-type"],
    },
  }),
);
```

`withCrypto()` without options creates a SHA-256 `Content-Digest` header only. HMAC signing requires an explicit secret and must not be used with secrets exposed to browser or mobile bundles.

See the [Russian documentation](./lang/ru/README.md) for API details, server-side verification, and atomic nonce storage requirements.

## Pipeline and compatibility

`withCrypto()`, `contentDigest()`, and `hmacSigner()` process only requests with `protocol: "rest"`. All other protocols (including WebRTC, gRPC, and `http`) pass through unchanged, without signing or digest generation.

All request crypto plugins run in `FORMAT`. Register them after plugins that transform the body or signed headers; when using separate plugins, register `contentDigest()` before `hmacSigner()`. Do not modify signed data afterward. The core pipeline implementation is not part of this package, so check ordering in your HyperTTP integration.

Bodies must be strings, `ArrayBuffer`, `ArrayBufferView`, or JSON values. Unsupported values (including `FormData`, `Blob`, streams, cyclic objects, and custom `toJSON`) throw a `TypeError`; serialize them to the exact transmitted bytes first.

**Migration:** the default header is now `Content-Digest` (RFC 9530), not `Digest`. Update header lookups and `includeHeaders` on both signing and verifying sides to `content-digest`. A custom `headerName` changes only the name, not the structured field format.

## License

[MIT](./LICENSE)
