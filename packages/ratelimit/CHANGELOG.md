# Changelog

## [3.0.0] - 2026-11-03

- Require `@hyperttp/types@^0.5.0` and validate against the registry declarations.

## [2.0.2] - 2026-11-02

### Added

- Added regression tests for queue cancellation, pooled node reuse, penalty locks, numeric boundaries, Retry-After parsing, and plugin state isolation.

### Changed

- Updated the `@hyperttp/types` peer dependency to `^0.4.2`.
- Updated `oxfmt` dependency to `^0.75.0`.
- Updated `oxlint` dependency to `^1.90.0`.
- Plugin-level `enabled` options now take precedence over client configuration, including explicit `false` values.

### Fixed

- Fixed unresolved promises when aborting the first request in the queue.
- Cleaned up abort listeners on cancellation, completion, and reset to prevent stale signals from affecting reused waiter nodes.
- Enforced penalty locks for immediate token consumption and queued requests, even when tokens have refilled.
- Prevented shorter penalties from reducing an active lock and cleared locks on reset.
- Reset the refill timestamp when applying a penalty to avoid crediting time elapsed before the penalty.
- Replaced signed 32-bit numeric coercion and split long timer delays into safe chunks to prevent overflow.
- Added strict Retry-After parsing for non-negative integer seconds and HTTP dates, with a two-second fallback for invalid values.
- Isolated limiter state, callbacks, and statistics per plugin context when sharing a plugin instance between clients.

## [2.0.1] - 2026-08-25

### Added

- Added `"type": "module"` to `package.json` for native ES module support.

### Changed

- Updated `oxfmt` dependency to `^0.65.0`.
- Updated `oxlint` dependency to `^1.80.0`.

## [2.0.0] - 2026-08-22

### Changed

- **Breaking:** Migrated the rate-limit plugin to the Core v2 universal request/response envelope.
- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Rate-limit hooks now operate on protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Request and response data now follow the Core v2 `input`, `metadata`, and `data` envelope fields.
