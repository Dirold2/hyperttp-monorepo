# Changelog

All notable changes to `@hyperttp/types` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-11-03

### Added

- Exported `CorePluginFactory`; `HyperClientOptions.pluginFactories` now uses
  this shared alias.
- Exported `ServerPluginContext` extending `ServerRequestContext` with the listen-bound
  `readonly protocol: HyperProtocolName`, and `ServerRequestOutcome` discriminating a raw
  `TransportResponse` success from an unknown error.
- Optional `HyperPlugin.onServerRequest`, `onServerResponse`, `onServerError`, and
  `onServerSettled` hooks accepting synchronous or asynchronous results. Server hooks
  always block independently of client mode and run in forward phase order: raw input
  before receive, serialized output after respond, first raw error response for recovery,
  and exactly-once settlement after preparation/recovery (not physical delivery), with
  diagnostic-only settlement errors. Client hooks/authentication are not automatic on servers.
- Exported `RequestOutcome` discriminated union for finalized logical request success or failure.
- Optional `RequestContext.onSettled()` and `acceptFinalResponse()` hooks, documenting
  once-per-logical-request settlement after blocking response/recovery, rejected late
  registration, diagnostic-only callback errors, and reuse of finalized follower responses
  without duplicate blocking/background response transforms or network I/O.

### Changed

- Adopted `HyperProtocolName` as the canonical protocol identifier across core,
  sender, receiver, protocol, and transport contracts.
  `SenderProtocol` remains available as a deprecated compatibility alias;
  new code should use `HyperProtocolName`.
- Sender/receiver registries now use the matching `AnyHyper*` aliases for `register()` and
  `get()`, preserving assignability of concrete protocol component types.
- `HyperProtocol` now preserves concrete sender/receiver prepared and raw transport types at
  protocol-module registration boundaries.

## [0.4.2] - 2026-09-09

### Added

- `AnyHyperSender<P>`, `AnyHyperReceiver<P>`, and `AnyHyperProtocol<P>` compatibility
  aliases for registering protocol components with concrete input, output, prepared, and raw types.
- `HyperProtocolName`, a protocol-neutral alias for identifiers shared by sender, receiver,
  and transport contracts.

### Changed

- `ServerPluginContext.protocol` now uses the protocol-neutral `HyperProtocolName` alias
  instead of the sender-oriented `SenderProtocol` name.
- `IHyperCore` sender, receiver, and protocol lookup/registration APIs now use the
  corresponding `AnyHyper*` aliases instead of `unknown`-parameterized component types.
- `BaseHyperClientOptions.protocols`, `senders`, `receivers`, and `customSender` now
  accept the corresponding `AnyHyper*` aliases, preserving assignability for concrete
  protocol implementations under strict function variance.
- `SenderRegistry`, `ReceiverRegistry`, and `ProtocolRegistry` now use the matching
  `AnyHyper*` aliases for their `register()` and `get()` contracts.
- `IHyperCore.send()` overload generics were reordered and given protocol-aware defaults:
  the inferred overload now accepts `TOutput` first, and the explicit overload defaults
  its protocol parameter to `SenderProtocol`.
- Expanded bilingual JSDoc for both `send()` overloads with guidance and examples for
  augmented and custom protocols.

## [0.4.1] - 2026-09-09

### Changed

- Updated repository metadata to `github.com/IT-IF-OR/hyperttp-types`.

## [0.4.0] - 2026-09-09

### Added

- `IHyperCore` introspection methods: `getProtocolName()`, `getSenderName()`,
  `getReceiverName()`, and `getTransportName()`.
- `ProtocolServerRequestMap` / `ProtocolServerResponseMap` registries with
  `InferProtocolServerRequest` / `InferProtocolServerResponse` utility types for
  protocol packages to connect server request and response types through Module Augmentation.
- A typed `IHyperCore.send()` overload based on `ProtocolInputMap` while preserving
  the generic fallback for custom protocols.
- Named `HyperMethod` and `HyperMethodSurface` contracts for dynamic sender methods.

### Changed

- `HyperServerListenOptions` now infers server request and response types from the protocol.
- `TransportRequest` now describes optional streaming and redirect-control capabilities.
- Transport shutdown documentation now distinguishes graceful `close()` from forced `destroy()`.

## [0.3.0] - 2026-08-21

> Breaking. The package becomes protocol-agnostic: HTTP-specific types move out
> into `@hyperttp/rest`, the core exposes a universal sender-based dispatch that
> external protocol packages extend via Module Augmentation.

### Added

- `HyperSender` interface — three-phase protocol adapter contract
  (`prepare` → `send` → `parse`) with an optional `methods` surface, in `types/sender.ts`.
- `SendRequest`, `UniversalResponse`, `RequestContext`, `SenderRegistry` universal envelopes.
- `ProtocolInputMap` / `ProtocolMetadataMap` registries with `InferProtocolInput` /
  `InferProtocolMetadata` utility types, extensible via Module Augmentation.
- `HyperProtocols` namespace container — the module augmentation contract for
  protocol packages (`@hyperttp/rest`, `@hyperttp/grpc`, …).
- `IHyperCore.send()`, `IHyperCore.getSender()`, `IHyperCore.registerSender()` —
  protocol-agnostic dispatch primitives.
- `HyperClientOptions` / `BaseHyperClientOptions` with `senders`, `receivers`, `protocols`,
  `customSender`, and `customTransport` options.
- `TransportRequest` / `TransportResponse` / `HyperTransport` in `types/transport.ts`
  — protocol-agnostic "dumb" network I/O contract shared by all transports.
- `HyperttpError<TReq, TRes>` type parameters for protocol-specific request/response context.
- `HyperReceiver` interface — three-phase server protocol adapter
  (`receive` → `handle` → `respond`) mirroring `HyperSender`, in `types/receiver.ts`.
- `ServerRequestContext` (extends `RequestContext` with `connection` / `peer`),
  `HyperServerListenOptions` and `ReceiverRegistry`.
- `HyperProtocol` unified protocol module with at least one side: client `sender`, server
  `receiver`, or both, and `ProtocolRegistry`, in `types/protocol.ts`.
- `HyperProtocol.name` — optional display name for protocol module introspection.
- Server transport capability: `HyperTransport.listen()` with
  `TransportListenOptions.onRequest` raw I/O callback and a `TransportServer` handle.
- `IHyperCore.getReceiver()`, `IHyperCore.registerReceiver()`, `IHyperCore.listen()`,
  `IHyperCore.getProtocol()`, `IHyperCore.registerProtocol()`.
- `receivers` and `protocols` options in `BaseHyperClientOptions`.
- Tooling: `oxlint` and `oxfmt` scripts (`lint`, `lint:fix`, `format`, `format:check`).

### Removed

- HTTP-specific modules moved out of the package:
  `types/http.ts`, `types/network.ts`, `types/request.ts`, `types/response.ts`,
  `types/stealth.ts`, `types/stream.ts`. These now belong to `@hyperttp/rest`
  and reach the core only through augmentation.
- Per-verb convenience methods (`get`/`post`/`stream`/`text`/`json`/`dump`, …) from `IHyperCore`.

### Changed

- `IHyperCore` reduced to the universal contract: `config`, `send`, sender registry,
  `use`, `extend`/`create`/`destroy`. Protocol methods are provided by augmentation.
- `IHyperCore` extended with the server side: receiver registry
  (`getReceiver` / `registerReceiver`) and `listen()`.
- `HyperTransport` gained the optional server capability `listen()`, enabling
  client-only, server-only and dual client-server transport implementations.
- `HyperttpError` request/response shapes are now generic and protocol-dependent.
- `LogLevel` is defined locally instead of being imported from the removed HTTP types.
- Plugin hooks `onRequest`/`onResponse`/`onError` now receive the per-request
  `RequestContext` (`reqCtx`) so plugins can share `state`/`meta` across phases.
- `HyperPlugin.onRequest` return type factored out into `PluginOnRequestResult<TInput, TOutput>`.
- `HyperSender`, `HyperReceiver`, and `HyperProtocol` now carry a protocol identifier generic,
  preventing modules from combining components for different protocols.
- `HyperProtocol` now requires a `sender`, a `receiver`, or both; empty protocol modules are
  rejected at compile time.
- Registry lookup APIs (`getSender`, `getReceiver`, `getProtocol`) now infer the returned
  component's protocol from their `protocol` argument instead of accepting an arbitrary caller-supplied type.
- Public generic defaults and client option collections now use `unknown` instead of `any`.
- `HyperSender.prepare()` now accepts a `SendRequest` for the sender's own protocol.
- `HyperPluginsExtension` was removed because its optional marker did not provide nominal typing.
- Package publishing now explicitly includes generated `dist` declarations through `files: ["dist"]`.
- README and bilingual JSDoc now describe client-only, server-only, and dual protocol modules;
  transport payloads; protocol-defined success; and runtime-owned option behavior.
- Comprehensive bilingual (ru/en) JSDoc across all modules.

## [0.2.5] - 2026-07-18

### Added

- `CacheOptions` interface (LRU `maxSize`, `ttl`) and `NetworkOptions.cache` /
  `cookieCache` for the transport layer.

### Changed

- Dev dependencies bumped: `@dirold2/dev-tools` ^1.1.0, `typescript` ^7.0.2, `@types/node` ^26.1.1.
- `tsconfig.json`: added `"DOM"` lib and `"types": ["node"]`.

## [0.2.4] - 2026-06-16

### Fixed

- Import paths in `types/network.ts` and `types/stream.ts` now use explicit `.js`
  extensions to keep ESM/NodeNext resolution consistent.

## [0.2.3] - 2026-06-16

### Added

- `types/stealth.ts` with `StealthOptions` (traffic masking / DPI evasion), wired
  into `NetworkOptions`.

### Removed

- `types/hyper.ts` — `IHyperCore` moved into `types/index.ts`.
- `types/response.ts` — `StreamResponse` moved into `types/stream.ts`.

### Changed

- `InternalRequest`/`Cloneable` relocated to `types/request.ts`, `HttpResponse`/
  `HyperStats` to `types/response.ts`; `types/options.ts` slimmed down.

## [0.2.1] - 2026-06-15

### Added

- `HyperAdapter<T>` interface in `types/adapters.ts` — drop-in compatibility
  adapter surface for third-party libraries (axios, ky, got).

### Changed

- `@types/node` moved from `dependencies` to `devDependencies`.
- Extensive bilingual (en/ru) JSDoc overhaul across all modules.

## [0.2.0] - 2026-06-12

### Added

- `HyperPlugin.onResponseData` hook — low-level interception of raw transport
  responses before parsing.
- `"DATA"` error code.

### Changed

- Plugin API overhaul in `types/plugin.ts`: explicit `phase` (`"PREPARE"` default)
  and `mode` (`"blocking"` / `"background"`) semantics, `enabled` predicate,
  `init` lifecycle hook.
- `types/transport.ts` reworked around `TransportResponse`.

### Removed

- `types/core.ts`, `types/errors.ts` and `types/plugins.ts` in favor of
  `types/error.ts` (`HyperttpError`) and `types/plugin.ts`.
- Stale committed `dist/` artifacts removed from the repository.

## [0.1.5] - 2026-06-10

### Added

- `HyperttpError` interface with request/response context (`types/error.ts`).
- New `types/response.ts` and `types/plugin.ts` modules.
- `"type": "module"`, package `files: ["dist"]`, simplified exports map.

### Changed

- Error system overhaul — rich error contracts replacing class-based errors.
- Major expansion of types and docs across all modules.

### Removed

- `types/core.ts`, `types/errors.ts`, `types/plugins.ts` and runtime error classes
  (`HttpClientError`, `TimeoutError`, `RateLimitError`) — the package is
  declaration-only.

## [0.1.1] - 2026-05-26

### Removed

- Runtime error classes (`HttpClientError`, `TimeoutError`, `RateLimitError`);
  `types/errors.ts` reduced to a compatibility interface.

## [0.1.0] - 2026-05-26

### Added

- Initial release of `@hyperttp/types`:
  `core`, `errors`, `http`, `hyper` (`IHyperCore`), `metrics`, `network`,
  `options`, `plugins`, `request`, `retry`, `stream`, `transport`.
