# Changelog

## [1.0.2] - 2026-11-02

### Added

- Marked requests participating in authentication with the non-secret `RequestContext.state["@hyperttp/auth.applied"]` boolean, including custom `apply()` adapters, for conservative cache/inflight integration.

### Fixed

- Cleared stale authentication markers alongside authentication identity before evaluating request eligibility.

### Documentation

- Documented conservative cache/inflight integration, credential-free scoped keys, and auth plugin registration order.
- Clarified that manually supplied query credentials and nonstandard authentication headers cannot be detected universally.

## [1.0.1] - 2026-11-02

### Fixed

- Restricted built-in Bearer, Basic, and API-key credentials to REST; other protocols use custom `apply()` adapters.
- Required a non-empty `allowedOrigins` list for built-in credentials and validated HTTP(S) origins without userinfo, paths, queries, or fragments.
- Preserved relative URL paths and fragments when adding query API keys.
- Loaded `config.auth` during plugin setup when explicit `withAuth()` options are absent, with explicit options taking precedence.
- Cleared stale authentication identity from active request contexts before authentication checks.

### Documentation

- Clarified cache/inflight integration requirements: include non-secret authentication identity and exclude credentials from cache keys.
- Clarified same-phase plugin ordering and sender/transport responsibility for redirect safety.
- Updated configuration examples to include trusted origins.

## [1.0.0] - 2026-10-20

### Added

- Added a protocol-agnostic outgoing authentication plugin with dynamic Bearer, Basic, and API-key credentials.
- Added `allowedOrigins`, per-request `shouldAuthenticate`, and custom `apply()` adapters for non-REST protocols.
- Added non-secret authentication identity propagation through `RequestContext.state` for cache and inflight partitioning.

### Fixed

- Preserved `Headers`, header tuples, and object headers when attaching authentication credentials.

### Documentation

- Documented REST authentication, custom protocol adapters, origin safety, and cache/inflight identity isolation.
