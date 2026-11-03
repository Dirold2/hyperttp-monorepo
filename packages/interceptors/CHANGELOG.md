# Changelog

## [3.0.0] - 2026-11-03

- Require `@hyperttp/types@^0.5.0` and validate against the registry declarations.

## [2.0.1] - 2026-11-02

### Fixed

- Enable interceptors configured through client options without requiring explicit `enabled: true`.
- Use each client's interceptor manager when a plugin instance is shared between clients.

### Changed

- Updated the `@hyperttp/types` peer dependency to `^0.4.2`.

## [2.0.0] - 2026-08-22

### Changed

- **Breaking:** Migrated the interceptors plugin to the Core v2 universal request/response envelope.
- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Interceptor hooks now operate on protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Request and response data now follow the Core v2 `input`, `metadata`, and `data` envelope fields.
