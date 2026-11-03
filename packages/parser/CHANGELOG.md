# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [3.0.2] - 2026-11-03

### Fixed

- Decode text/JSON and return binary bytes without requiring global Buffer in browsers. UTF-8 string-to-buffer conversion uses TextEncoder when Buffer is unavailable; other string encodings fail explicitly instead of silently producing incorrect bytes.
- Honor configured TextDecoder-supported charsets on Buffer-free decoding paths.
- Added Buffer-free regression tests and verified the built high-level client in Chromium without Node polyfills.

All notable changes to this project will be documented in this file.

## [3.0.0] - 2026-11-02

### Added

- Added XML building through the standalone `fast-xml-builder` package: `convert(data, "xml")` now builds XML from plain objects and arrays, while strings and binary bodies continue to be parsed through `fast-xml-parser`.
- Added `xmlBuilderOptions` for configuring XML output. By default, the builder preserves attributes using the `@_` prefix, matching the parser defaults.
- Added actionable installation errors when an optional HTML/XML dependency cannot be loaded.
- Added tests for optional dependencies, XML round-trip conversion, builder options, and per-request XML settings.

### Changed

- **Breaking:** Moved `node-html-parser`, `fast-xml-parser`, and `fast-xml-builder` from required dependencies to optional peer dependencies. Install only the packages needed for HTML parsing, XML parsing, or XML building; each is loaded lazily.
- Updated the `@hyperttp/types` peer dependency to `^0.4.2`.
- Updated English and Russian documentation with optional dependency installation and XML conversion examples.

### Fixed

- Prevented per-request `xmlParserOptions` and `xmlBuilderOptions` from reusing converters cached with different XML settings.

### Migration

- Install `node-html-parser` explicitly for HTML parsing, `fast-xml-parser` for XML parsing, and `fast-xml-builder` for XML building.
- Use `parseHTML: false` to receive HTML as a string without an HTML parser, or request `text` for raw HTML/XML.
- Passing a plain object or array to `convert(data, "xml")` now produces an XML string rather than attempting to parse the input.

## [2.0.1] - 2026-08-24

### Fixed

- Preserved native stream response bodies when `SendRequest.input.stream` is enabled, independent of optional `metadata.responseType`.

## [2.0.0] - 2026-08-22

### Added

- Added protocol-neutral callbacks: `shouldParse`, `getData`, `getResponseType`, and `isEmptyResponse`. Each callback may be synchronous or asynchronous and receives the response, request, and request context.
- Added `bodyExtractor` as an alias for `getData` and `detectResponseType` as an alias for `getResponseType`.
- Exported parser-owned response, conversion metadata, callback, request-context, and response-type types.
- Added explicit REST defaults for `HEAD` and empty `204`, `205`, and `304` responses.

### Changed

- **Breaking:** Migrated to the `@hyperttp/types` 0.3 universal API: responses use `data`, protocol requests use `input`, and per-request values use `metadata`.
- **Breaking:** Response conversion no longer mutates the incoming response; the plugin returns a new `UniversalResponse` when `data` changes.
- **Breaking:** Moved client option augmentation to `HyperClientOptions` and updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Restricted default HTTP empty-response behavior to the REST protocol. Other protocols can define equivalent behavior through callbacks.
- Request settings are resolved from `RequestContext.meta` and `SendRequest.metadata`, with request metadata taking precedence.
- Explicit response types now take precedence over `Content-Type`.

### Fixed

- Preserved already-converted JSON objects, arrays, numbers, and booleans instead of converting them again.
- Preserved JSON objects containing transport-like fields such as `raw`, `body`, `headers`, or `status` when processed through the plugin.
- Fixed JSON fast-path handling for numeric and boolean values.
- Avoided reading response headers when the response type is explicit or data is already converted.

### Performance

- Added pass-through fast paths for already-converted values, avoiding redundant header lookup, response-type detection, conversion, and response allocation.
- Automatic conversion metadata now reads only `Content-Type` and is created only for `responseType: "auto"`.
- Removed repeated content-type normalization from the conversion fast path.

### Migration

- Replace response access through `body` with `data`.
- Replace HTTP-specific request fields with protocol-specific `SendRequest.input`.
- Move per-request `responseType` and `responseConverter` values from legacy `meta` fields to `metadata`.
- Register `withParser()` explicitly when the plugin is not supplied by the `hyperttp` package.

## [1.2.0] - 2026-07-19

### Changed

- **Replaced `cheerio` with `node-html-parser`** for HTML parsing — lighter dependency, no DOM emulation overhead.
- `htmlToJson()` rewritten to use `querySelector` / `querySelectorAll` / `getAttribute` API instead of cheerio's jQuery-like interface.
- Lazy loader renamed from `getCheerio()` to `getHtmlParser()`.

### Fixed

- **Critical bug in `slow()` buffer path for Bun**: `decoder.decode(TextEncoder.encode(text))` was encoding then immediately decoding, returning a `string` instead of `Uint8Array`. Now correctly returns `new TextEncoder().encode(text)`.

### Improved

- **Bun-native `ReadableStream` reading**: `readReadableStream()` now uses `new Response(stream).arrayBuffer()` on Bun, delegating to the C++ fast path instead of manual JS chunk iteration.
- **Unified conversion pipeline**: Merged `fastBun` / `fastNode` into a single `fast()` method with runtime branching only where it matters (buffer output). Removed `convertBun` / `convertNode` — `convertBody()` is now a clean `tryNative → fast → slow` chain.
- **Centralized `bodyToBytes()` extractor**: Single source of truth for resolving any body type (Uint8Array, ArrayBuffer, Buffer, Blob, ReadableStream, AsyncIterable, Node stream) to `Uint8Array`. Eliminates duplicated type-checking cascades across `fast`, `toText`, and `resolveJsonBody`.
- **DRY refactoring**: Extracted `bytesToText()`, `tryParseJson()`, and `resolveJsonBody()` helpers. JSON parsing deduplicated from ~80 lines per runtime to a single call.
- **Typed parser fields**: `_xmlParser` and `_htmlParser` fields now carry minimal type signatures instead of `any`.
- Updated `README.md` to reflect the new HTML parser dependency.

## [1.1.9]

- Version bump.

## [1.1.8]

- Previous release (last tagged version before refactor).

## [1.0.0] - Initial

- Initial public release.
- Automatic response type detection (`auto`) from `Content-Type` and URL extension.
- Runtime-aware conversion pipeline: `fastBun` / `fastNode` with lazy dynamic imports for heavy parsers.
- Support for `json`, `text`, `buffer`, `html`, `xml`, `stream` response types.
- HTML-to-JSON extraction (simple and full modes).
- XML parsing via `fast-xml-parser`.
- Stream cleanup on error responses.
- Performance timing via `trackTimings` option.
