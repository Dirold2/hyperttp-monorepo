# @hyperttp/queue

> English | [Русский](https://github.com/IT-IF-OR/hyperttp-queue/tree/main/lang/ru)

Concurrency queue plugin for Hyperttp.

## Features

- Controls concurrent request execution in the Core v2 pipeline.
- Supports protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Helps protect downstream services from request bursts.
- Supports per-partition concurrency limits and cancellation while waiting.
- Holds slots until final request settlement when Core exposes `RequestContext.onSettled`.

## Installation

```bash
npm install @hyperttp/queue
# or
bun add @hyperttp/queue
```

Version 3 requires `@hyperttp/types` compatible with `^0.5.0`.

## Usage

```ts
import { HyperClient } from "hyperttp";
import { withQueue } from "@hyperttp/queue";

const client = new HyperClient({
  plugins: [withQueue({ maxConcurrent: 50 })],
});
```

Configure the plugin with the exported `QueueOptions` type.

- Passing options to `withQueue(...)` enables the plugin unless `enabled: false` is set. With `withQueue()` without arguments, set `queue.enabled: true` in the client configuration.
- Client `queue` settings override factory options. Setting only `queue.maxConcurrent` does not enable the plugin.
- `maxConcurrent` must be finite; `NaN` and infinities throw `RangeError`. Finite values are rounded down and clamped to at least one. The default plugin limit is 500.
- The limit applies separately to each `partitionKey`, not globally. Idle partitions are removed automatically.
- Waiting is cancelled when either the request signal or the context signal aborts. Combining two distinct signals requires runtime support for `AbortSignal.any` (for example, Node.js 20.3+).

## Final lifecycle compatibility

When Core provides optional `RequestContext.onSettled`, an acquired slot is held
until final settlement (success, error, or cancellation), including response
transformations. Intermediate response/error hooks do not release it. Each
acquisition registers one settlement callback and release is idempotent. On older
Core versions without this capability, response/error hooks release slots as before.

## License

MIT © dirold2
