# @hyperttp/ratelimit

> English | [Русский](https://github.com/IT-IF-OR/hyperttp-ratelimit/tree/main/lang/ru)

Rate limiting plugin for Hyperttp.

## Features

- Limits request throughput in the Core v2 pipeline.
- Supports protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Helps keep client traffic within downstream service limits.

## Installation

```bash
npm install @hyperttp/ratelimit
# or
bun add @hyperttp/ratelimit
```

## Usage

```ts
import { HyperClient } from "hyperttp";
import { withRateLimit } from "@hyperttp/ratelimit";

const client = new HyperClient({
  plugins: [withRateLimit()],
});
```

Configure the plugin with the exported `RateLimitOptions` type.

## License

MIT © dirold2
