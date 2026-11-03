# @hyperttp/serializer

> English | [Русский](https://github.com/IT-IF-OR/hyperttp-serializer/tree/main/lang/ru)

Request serialization plugin for Hyperttp.

## Features

- Serializes request payloads in the Core v2 pipeline.
- Supports protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Keeps payload transformation as an optional plugin.

## Installation

```bash
npm install @hyperttp/serializer
# or
bun add @hyperttp/serializer
```

## Usage

```ts
import { HyperClient } from "hyperttp";
import { withSerializer } from "@hyperttp/serializer";

const client = new HyperClient({
  plugins: [withSerializer()],
});
```

Configure the plugin with the exported `SerializerOptions` type.

## License

MIT © dirold2
