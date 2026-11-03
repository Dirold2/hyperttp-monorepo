# @hyperttp/parser

> [English](https://github.com/IT-IF-OR/hyperttp-parser) | [Русский](https://github.com/IT-IF-OR/hyperttp-parser/tree/main/lang/ru)

Automated response parsing and content conversion plugin for Hyperttp.

## Features

- Detects JSON, HTML, XML, text, and binary responses automatically.
- Supports explicit `auto`, `json`, `text`, `html`, `xml`, `buffer`, and `stream` response types.
- Explicit response types take precedence over `Content-Type`.
- Supports protocol-neutral callbacks for data extraction and response-type detection.
- Passes through values that have already been converted.
- Returns a new `UniversalResponse` when `data` changes instead of mutating the input.

## Installation

```bash
npm install @hyperttp/parser
# or
bun add @hyperttp/parser
```

## Optional HTML and XML support

JSON, text, binary, and stream responses work without additional dependencies.
Install only the parser you need:

```bash
npm install node-html-parser # HTML
npm install fast-xml-builder # XML building (separate package)
npm install fast-xml-parser  # XML parsing
```

These packages are optional peer dependencies and are loaded only when parsing the
corresponding format, including when detected through `auto`. If the required parser
is missing, conversion rejects with an installation hint. Use `parseHTML: false` to
return HTML as a string without `node-html-parser`, or request `text` for raw HTML/XML.
`fast-xml-builder` is also available as a separate optional peer dependency for XML building.

## Usage

The `hyperttp` package registers the parser automatically:

```ts
import { HyperClient } from "hyperttp";

const client = new HyperClient({
  responseConverter: {
    parseHTML: true,
    htmlMode: "full",
  },
});

const user = await client.get<{ id: number }>(
  "https://api.example.com/users/1",
  "json",
);
```

Disable the built-in parser with `responseConverter: false`:

```ts
const client = new HyperClient({
  responseConverter: false,
});
```

When using `@hyperttp/core` directly, register the plugin explicitly:

```ts
import { HyperCore } from "@hyperttp/core";
import { withParser } from "@hyperttp/parser";

const core = new HyperCore();
core.use(withParser({ htmlMode: "full" }));
```

Importing `@hyperttp/parser` alone does not register the plugin.

## Response types

| Type | Result |
| --- | --- |
| `auto` | Detect from `Content-Type` or URL extension |
| `json` | Parsed JavaScript value |
| `text` | String |
| `html` | Parsed HTML or the original string when `parseHTML: false` |
| `xml` | Objects/arrays → XML via `fast-xml-builder`; strings/binary data → parsed value via `fast-xml-parser` |
| `buffer` | `Buffer` in Node.js or `Uint8Array` in Bun |
| `stream` | Passed through without conversion |

## XML conversion

```ts
import { ResponseConverter } from "@hyperttp/parser";

const converter = new ResponseConverter({ xmlBuilderOptions: { format: true } });
const xml = await converter.convert({ root: { value: "42" } }, "xml");
const data = await converter.convert(xml, "xml"); // { root: { value: "42" } }
```

Plain objects and arrays build XML; strings and binary bodies are parsed as XML.
The builder preserves `@_` attributes by default, matching the parser defaults.
Only the dependency for the selected direction is loaded. `null`/`undefined` remain `null`.

## Configuration

`withParser(options?)` supports `charset`, `parseHTML`, `htmlMode`, `xmlParserOptions`, `xmlBuilderOptions`,
`shouldParse`, `getData`/`bodyExtractor`, `getResponseType`/`detectResponseType`, and
`isEmptyResponse`. Callbacks can be synchronous or asynchronous and receive the response,
request, and request context.

For REST, `HEAD` responses are skipped by default, and statuses `204`, `205`, and `304`
are returned with `data: null`. Other protocols can define their own behavior through callbacks.

> `maxBodySize` and `parseErrors` are reserved options in v2.0.0 and are not currently
> applied during conversion.

## License

MIT © dirold2
