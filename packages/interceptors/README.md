# @hyperttp/interceptors

> English | [Русский](https://github.com/IT-IF-OR/hyperttp-interceptors/tree/main/lang/ru)

Request and response interceptor plugin for Hyperttp.

## Features

- Runs user-defined handlers around the Core v2 request lifecycle.
- Supports request, response, and error interception.
- Uses protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.

## Installation

```bash
npm install @hyperttp/interceptors
# or
bun add @hyperttp/interceptors
```

## Usage

```ts
import { HyperClient } from "hyperttp";
import { withInterceptors } from "@hyperttp/interceptors";

const client = new HyperClient({
  plugins: [withInterceptors({
    onRequest: (request) => request,
  })],
});
```

See the exported `InterceptorsOptions` type for available lifecycle callbacks.

## License

MIT © dirold2
