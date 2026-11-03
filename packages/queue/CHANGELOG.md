# Changelog

## [3.0.1] - 2026-11-03

- Require `@hyperttp/types@^0.5.0` and validate against the registry declarations.
- Use shared RequestContext/RequestOutcome contracts instead of local settlement interface duplicates.

## [3.0.0] - 2026-11-03

### Changed

- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.5.0`.
- When Core provides `RequestContext.onSettled`, queue slots are held until final settlement, including response transformations. Intermediate response/error hooks no longer release these slots.
- Core versions without `onSettled` retain response/error hook-based slot release.
- **Breaking:** Non-finite `maxConcurrent` values (`NaN`, `Infinity`, and `-Infinity`) now throw `RangeError` instead of causing indefinite waiting or disabling the limit. Finite values are still rounded down and clamped to at least one.

### Fixed

- Queue waiting now observes both request and context cancellation signals when they differ, using `AbortSignal.any`.
- Idle partition queues are removed to avoid retaining unused partition keys.

### Tests

- Added regression coverage for concurrency validation, cancellation signals, partition cleanup, configuration precedence, and plugin activation.
- Added final-settlement lifecycle coverage.

## [2.0.0] - 2026-08-22

### Changed

- **Breaking:** Migrated the queue plugin to the Core v2 universal request/response envelope.
- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Queue hooks now operate on protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Request and response data now follow the Core v2 `input`, `metadata`, and `data` envelope fields.
