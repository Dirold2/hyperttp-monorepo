# Changelog

## [3.0.0] - 2026-11-03

- Require `@hyperttp/types@^0.5.0` and validate against the registry declarations.
- Added `createRetryPlugin()` for per-Core ownership; deprecated the reusable setup-bearing singleton without removing it.

All notable changes to `@hyperttp/retry` are documented in this file.

## [2.0.1] - 2026-11-02

### Added

- Retries for responses with status codes `429`, `500`, `502`, `503`, and `504`, in addition to thrown errors.
- Support for `Retry-After` headers in seconds and HTTP-date format. If the requested delay exceeds the configured limits, the response is returned without retrying.
- A total elapsed time budget, `retry.maxElapsedMs` (30 seconds by default), covering attempts and delays. This limit does not interrupt an active request.
- A custom, optionally asynchronous `retry.shouldRetry` policy and an exported `RetryDecision` type.
- Cancellation through `AbortSignal`, including interruption of backoff delays.
- Documentation for retry policies, limits, and the request lifecycle.
- Tests for replay safety, response handling, `Retry-After`, cancellation, repeated installation, and logging.

### Changed

- By default, only REST requests using `GET`, `HEAD`, `OPTIONS`, `PUT`, and `DELETE` are retried. Other methods and protocols require an explicit `shouldRetry` policy.
- Retryable network errors are limited to `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EPIPE`, and `EAI_AGAIN`.
- Streaming bodies and bodies of unknown classes are never replayed, even with a custom policy. Streaming responses are excluded from the default policy.
- Retry logs no longer contain transport error messages or request URLs.

### Fixed

- Repeated wrapper installation no longer multiplies retry attempts: the first installation owns the policy.
- `withRetry` respects `enabled: false` and can be called without an options argument.
- Added validation for numeric retry and delay limits.
- Preserved both public overloads of `IHyperCore.send`.

## 2.0.0

### Breaking Changes

- Replaced the `@hyperttp/core` dependency with a peer dependency on `@hyperttp/types ^0.4.2`.
- Migrated the retry wrapper from `dispatch` to `send`, using `IHyperCore`, `SendRequest`, `UniversalResponse`, and `HyperClientOptions`.
- Migrated plugin registration from `apply` to the `setup` hook.
- Moved the `retry.enabled` type extension to the `RetryOptions` interface in `@hyperttp/types`.
- Declared the package as ESM and added an `exports` map.

### Fixed

- Preserved the `this` binding when calling the original `send` method.
- Added safe handling of `unknown` errors, including `null` and primitive values.
- Passed client configuration to `withRetry` during plugin registration to support logging.

### Tooling and Tests

- Updated development dependencies, including TypeScript 7.
- Replaced ESLint and Prettier with Oxlint and Oxfmt.
- Added minification and source maps through esbuild, along with distribution and publishing commands.
- Added tests for retries, exponential backoff, jitter, limits, registration, and logging.
