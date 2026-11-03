# Changelog

## [2.0.5] - 2026-11-02

### Tests

- Added explicit checks that concurrent requests with the same authentication identity are deduplicated across token rotation without including tokens in cache keys.
- Added checks that concurrent requests with different authentication identities remain isolated even when credentials match.
- Covered custom-key cache and deduplication bypass when the authentication identity is missing, empty, or invalid.

### Documentation

- Highlighted migration from `2.0.3`: authenticated caching and in-flight deduplication require an explicit credential-free key with a non-secret identity.
- Clarified that auth identity is only published when `getCacheKey()` is configured and returns a value; query credentials and arbitrary auth headers require explicit safe-key or bypass configuration.

## [2.0.4] - 2026-11-02

### Fixed

- Bypassed default caching and in-flight deduplication for requests with `@hyperttp/auth.identity` or `Authorization`, `Proxy-Authorization`, `Cookie`, or `X-API-Key` headers, avoiding serialization of those authenticated inputs into cache keys.
- Added regression tests for credential headers in object, `Headers`, and tuple formats, authenticated input serialization bypass, and identity isolation with explicit cache keys.
- Verified concurrent auth request deduplication across token rotation, separation of different identities, and custom-key bypass when a safe identity is missing or invalid.

### Changed

- **Behavior change / migration:** Requests with auth identity or standard credential headers no longer use the default cache key. To retain caching and in-flight deduplication, configure an explicit credential-free `key` including a non-secret authentication identity; return `undefined` when that identity is unavailable.

### Documentation

- Documented auth-before-cache registration order, safe custom cache keys, and the need to explicitly handle query credentials, arbitrary API-key headers, and custom protocol adapters.
- Corrected the README configuration type and supported option names.

## [2.0.3] - 2026-10-20

### Fixed

- Partitioned default REST cache keys by the non-secret `@hyperttp/auth.identity` request state so cached responses cannot cross authentication identities.
- Updated the `@hyperttp/types` peer and development dependency to `^0.4.2`.

## [2.0.0] - 2026-08-22

### Changed

- **Breaking:** Migrated the cache plugin to the Core v2 universal request/response envelope.
- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Cache request and response hooks now operate on protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Preserved cache behavior while moving request data to protocol-specific `input` and response payloads to `data`.

## [1.2.0] - 2026-07-19

### Added

- `hcacher` as runtime dependency — event bus (`hit`, `miss`, `set`, `evict`, `expire`)
- `getOrSet()` with built-in concurrent request deduplication
- `enabled` flag to disable cache at runtime
- `MiniEmitter` and `CacheEvents` re-exported from `hcacher`

### Changed

- `CacheManager` replaced with `hcacher`'s implementation
- `getWithMetadata()` → `getEntry()`
- `setWithMetadata()` → `set()` with optional `meta` parameter
- `updateAgeOnGet` option renamed to `touchOnGet`

### Removed

- Local `CacheManager` implementation (185 lines)

## [1.1.6] - 2026-05-29

### Changed

- Refactored plugin logic, extracted `createHttpResponse` utility
- Removed test files

## [1.1.5] - 2026-05-29

### Changed

- Updated dev dependencies

## [1.1.1] - 2026-05-29

### Changed

- Updated README documentation

## [1.1.0] - 2026-05-27

### Added

- HTTP revalidation via `ETag` / `Last-Modified` conditional headers
- In-flight request deduplication
- Cache stampede protection

### Changed

- Refactored plugin architecture with `onRequest` / `onResponse` / `onError` hooks
- Expanded test suite

## [1.0.22] - 2026-05-25

### Changed

- Simplified package.json exports

## [1.0.18] - 2026-05-25

### Added

- `methods` option to configure cacheable HTTP methods

## [1.0.13] - 2026-05-24

### Changed

- Simplified plugin internals

## [1.0.11] - 2026-05-24

### Added

- CacheManager unit tests

## [1.0.8] - 2026-05-24

### Changed

- Split `CacheEntry` and `CacheManagerOptions` into dedicated types file

## [1.0.7] - 2026-05-24

### Changed

- Refactored plugin request/response handling

## [1.0.5] - 2026-05-23

### Changed

- Improved plugin configuration interface

## [1.0.2] - 2026-05-23

### Changed

- Refactored plugin structure

## [1.0.0] - 2026-05-21

### Added

- Initial release
- In-memory LRU cache with TTL
- `withCache` plugin factory for `@hyperttp/core`
- Configurable `maxSize`, `ttl`, `updateAgeOnGet`
- Isomorphic TypeScript (Bun + Node.js)
