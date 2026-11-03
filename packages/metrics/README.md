# @hyperttp/metrics

> English | [Русский](https://github.com/IT-IF-OR/hyperttp-metrics/tree/main/lang/ru)

Metrics plugin for Hyperttp.

## Features

- Collects request lifecycle metrics from the Core v2 pipeline.
- Supports protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Keeps metrics collection isolated as an optional plugin.

## Installation

```bash
npm install @hyperttp/metrics
# or
bun add @hyperttp/metrics
```

## Usage

```ts
import { HyperClient } from "hyperttp";
import { withMetrics } from "@hyperttp/metrics";

const client = new HyperClient({
  plugins: [withMetrics()],
});
```

Configure the plugin with the exported `MetricsOptions` type.

### URL labels and sensitive data

Default `requestLabels.url`, collected `url`, and `operationKey` retain only the
URL origin and pathname: username/password, query strings, and fragments are
removed entirely. Relative URLs are resolved against an internal base and labeled
with only their pathname (for example, `widgets?token=secret` becomes `/widgets`).
Invalid or non-network URLs are omitted rather than recorded verbatim.

Custom `extractors.requestLabels` and `extractors.operationKey` are explicit
overrides. Their results are stored unchanged, including when they return
`undefined`; defaults are not applied afterward. **Custom extractors must redact
credentials and other secrets themselves.** Pathnames are retained by default,
so use custom extractors if your application also puts sensitive data in paths.

## License

MIT © dirold2


## Core3 lifecycle compatibility

Requires `@hyperttp/types ^0.5.0`. When `RequestContext.onSettled` is available, metrics
are recorded once from the final logical outcome, after blocking response transformations
and error recovery. Duration includes that work; a recovered successful response counts as
success, while a final rejection or resolved response with `ok: false` counts as failure by
default. Custom outcome/status extractors remain authoritative.

Contexts without settlement support retain response/error-hook collection and cannot
reliably observe later recovery or transformations. Register metrics before short-circuiting
plugins such as cache so timing and settlement registration also run for hits and followers.
Background hook work and streaming-body consumption are not included in settlement timing.
