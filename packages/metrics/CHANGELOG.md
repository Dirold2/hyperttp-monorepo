# Changelog

## [2.0.1] - 2026-11-02

### Fixed

- Default `requestLabels.url`, collected `url`, and `operationKey` now strip URL credentials, query strings, and fragments to prevent sensitive data from leaking into metrics.
- Relative URLs are normalized to pathnames; invalid and non-network URLs are omitted instead of recorded verbatim.

### Changed

- Updated the `@hyperttp/types` peer dependency to `^0.4.2`.
- Updated development tooling dependencies (`oxfmt` and `oxlint`).

### Added

- Documentation for default URL sanitization and custom extractors, which remain responsible for redacting sensitive data in their results.
- Regression tests for URL sanitization, error-path metrics, and custom extractor overrides.

## [2.0.0] - 2026-08-22

### Changed

- **Breaking:** Migrated the metrics plugin to the Core v2 universal request/response envelope.
- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Metrics hooks now observe protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Request and response data now follow the Core v2 `input`, `metadata`, and `data` envelope fields.
