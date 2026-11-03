# Changelog

## [2.0.1] - 2026-11-02

### Changed

- Updated the `@hyperttp/types` peer dependency to `^0.4.2`.
- Updated `oxfmt` to `^0.75.0` and `oxlint` to `^1.90.0`.
- Explicitly set the serializer plugin execution mode to `blocking` in the `FORMAT` phase.

### Fixed

- Preserved `TInput` in internal request helpers to avoid type incompatibilities between `SendRequest<TInput>` and `SendRequest<unknown>`.

### Tests

- Added coverage for the plugin name, execution phase, blocking mode, and activation predicate.

## [2.0.0] - 2026-08-22

### Changed

- **Breaking:** Migrated the serializer plugin to the Core v2 universal request/response envelope.
- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Serializer hooks now operate on protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Request and response data now follow the Core v2 `input`, `metadata`, and `data` envelope fields.
