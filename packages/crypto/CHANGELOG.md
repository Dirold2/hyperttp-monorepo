# Changelog

## Unreleased

### Changed

- **Breaking:** the default digest header is now `Content-Digest` (RFC 9530). Update signed `includeHeaders` and header lookups on both sides to `content-digest`.
- Standalone `hmacSigner()` now runs in `FORMAT`, consistently with `withCrypto()`. Register crypto plugins after body and signed-header transformations.
- Unsupported runtime body values now throw a `TypeError` instead of being silently serialized as unrelated JSON.

### Fixed

- Corrected the test import after moving `withCrypto()` to `src/plugin.ts`.
- HMAC verification accepts uppercase hexadecimal signatures.
- Default `withCrypto()` options no longer recreate the digest plugin on every request.

## [1.0.2] — 2026-08-30

### Added

- Module augmentation for `HyperClientOptions.crypto`, accepting `WithCryptoOptions` directly in HyperTTP client configuration.

### Changed

- `withCrypto()` now uses `context.config.crypto` when no explicit plugin options are provided.
- Explicit `withCrypto(options)` configuration takes precedence over `HyperClientOptions.crypto`.

## [1.0.1] — 2026-08-30

### Changed

- `withCrypto()` is compatible with clients that register plugins as `HyperPlugin<unknown>` and safely skips unsupported request inputs.

## [1.0.0] — 2026-08-30

### Added

- `contentDigest()` for generating HTTP `Digest` headers from supported request bodies.
- `hmacSigner()` for HMAC request signing with timestamp, optional nonce, origin, path/query, exact body bytes, and selected headers.
- `withCrypto()` to compose Digest generation and optional HMAC signing as one HyperTTP plugin.
- `verifyHmac()` for server-side HMAC and timestamp-freshness verification.
- `verifyIncomingRequest()` and atomic `NonceStore` support for replay protection.
- Canonical request, byte-encoding, hexadecimal, Base64, and timing-safe comparison utilities.
- Russian documentation with client, server verification, and nonce-store examples.

### Changed

- Exported plugins and utilities now include bilingual `@ru` and `@en` JSDoc documentation.


### Security

- HMAC canonicalization binds the request method, origin, path and query, timestamp, nonce, body bytes, and explicitly selected headers.
- Replay protection requires an atomic nonce-consumption operation, preventing concurrent reuse of the same nonce.
