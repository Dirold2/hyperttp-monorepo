# BunTransport

`BunTransport` is a high-performance HTTP transport for the
[HyperTransport](https://github.com/IT-IF-OR) ecosystem, designed for the **Bun runtime**.

It wraps native `fetch` and adds:

- concurrency limiting with FIFO queue
- request timeouts via `AbortSignal`
- automatic cookie handling with TTL and LRU eviction
- response caching for GET/HEAD requests
- stealth / fingerprint mimicry (JA3/JA4)
- header normalization
- `keepalive` support
- TLS configuration (ciphers, `rejectUnauthorized`)

---

## Interface

```ts
export interface HyperTransport {
  readonly protocols?: readonly string[];
  supports?(protocol: string): boolean;
  execute(req: TransportRequest): Promise<TransportResponse>;
  listen?(options: TransportListenOptions): Promise<TransportServer>;
  close?(): Promise<void>;
  destroy?(): Promise<void>;
}
```

`BunTransport` implements this interface and can be used as a runtime-specific HTTP transport in client libraries.

---

## Features

- `fetch`-based implementation with `signal` support
- automatic merging of cookies from responses and subsequent requests
- cookie cache per domain with configurable TTL
- response cache for GET/HEAD requests (optional, via `hcacher`)
- request concurrency limiting with FIFO queue
- request timeout support
- stealth mode: browser-like TLS fingerprint emulation (Chrome, Firefox, Safari, Edge)
- `baseUrl` support for relative URLs
- compatibility with `TransportRequest` / `TransportResponse`

---

## Installation

`BunTransport` is designed for Bun, so the project must run in the Bun runtime.

```bash
bun add @hyperttp/transport-bun
```

Peer dependencies: `@hyperttp/types`, `hcacher`.

---

## HTTP server

```ts
import { BunTransport } from "@hyperttp/transport-bun";

const transport = new BunTransport({});
const server = await transport.listen({
  host: "127.0.0.1",
  port: 3000,
  onRequest(request) {
    return {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "Hello from Bun!",
    };
  },
});

await server.close();
```

`listen` uses `Bun.serve` and passes incoming bodies as raw `ReadableStream`s.
Without `onRequest`, requests receive HTTP 503. An optional `signal` stops the
server when aborted. `server.close()` stops one server gracefully;
`transport.close()` stops all its servers gracefully, while `transport.destroy()`
forcefully closes active connections.

## Usage

```ts
import { BunTransport } from "@hyperttp/transport-bun";

const transport = new BunTransport({
  baseUrl: "https://api.example.com",
  network: {
    timeout: 10_000,
    maxConcurrent: 32,
    keepAliveTimeout: 30_000,
    rejectUnauthorized: true,
  },
});

const response = await transport.execute({
  url: "/users",
  method: "GET",
  protocol: "rest",
  headers: {},
  body: null,
});

console.log(response.status);
console.log(await new Response(response.body).text());
```

---

## Configuration

`BunTransport` accepts a `BunTransportConfig` object:

```ts
interface BunTransportConfig {
  baseUrl?: string;
  stealth?: StealthOptions;
}
```

### Network options

```ts
network?: {
  maxConcurrent?: number;
  timeout?: number;
  keepAliveTimeout?: number;
  rejectUnauthorized?: boolean;
  cookieCache?: {
    enabled?: boolean;
    maxSize?: number;
    ttl?: number;
  };
  cache?: {
    enabled?: boolean;
    maxSize?: number;
    ttl?: number;
  };
}
```

| Option               | Description                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `maxConcurrent`      | Maximum number of concurrent active requests (0 = unlimited)                                   |
| `timeout`            | Global request timeout in milliseconds (0 = no timeout)                                        |
| `keepAliveTimeout`   | Enables `keepalive` mode when provided                                                         |
| `rejectUnauthorized` | Passed to Bun `fetch` via `tls` configuration                                                  |
| `cookieCache`        | Cookie cache settings: `enabled` (default true), `maxSize` (default 256), `ttl` (default 300s) |
| `cache`              | Response cache settings for GET/HEAD: `enabled`, `maxSize` (default 256), `ttl` (default 30s)  |

---

## Cookies

The transport supports persistent cookie storage with TTL and LRU eviction, backed by `hcacher`.

### How it works

1. When the server returns `Set-Cookie`, cookies are stored per domain with a TTL.
2. On subsequent requests to the same domain, cookies are automatically attached to the `Cookie` header.
3. If the user provides their own `Cookie` header, it is merged with stored cookies.
4. Expired entries are evicted automatically (LRU).

### Example

```ts
await transport.execute({
  url: "/login",
  method: "POST",
  protocol: "rest",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login: "demo", password: "secret" }),
});

// Cookies from /login are automatically sent
const res = await transport.execute({
  url: "/profile",
  method: "GET",
  protocol: "rest",
  headers: {},
  body: null,
});
```

---

## Response caching

When `network.cache` is configured, GET and HEAD requests are cached automatically with TTL and LRU eviction.

```ts
const transport = new BunTransport({
  network: {
    cache: {
      enabled: true,
      maxSize: 512,
      ttl: 60_000, // 1 minute
    },
  },
});
```

Cached responses are returned instantly on repeated requests to the same URL within the TTL window.

---

## Concurrency limiting

If `maxConcurrent > 0`, incoming requests are queued until a slot becomes available.

This is useful for:

- preventing server overload
- limiting runtime resource usage
- avoiding traffic spikes

---

## Timeout & cancellation

The transport uses `AbortSignal`:

- if `req.signal` is provided, it is respected
- if `timeout` is set, `AbortSignal.timeout(...)` is created
- if both exist, they are combined using `AbortSignal.any(...)`

If a request is aborted, the signal reason (or a default `AbortError`) is thrown.

---

## Stealth / fingerprint mimicry

`BunTransport` supports browser-like TLS fingerprint emulation to bypass fingerprint-based protections (JA3/JA4).

### Supported profiles

| Profile | TLS ciphers   | sec-ch-ua     | User-Agent  |
| ------- | ------------- | ------------- | ----------- |
| chrome  | Chrome suite  | Chrome 126    | Chrome 126  |
| firefox | Firefox suite | Firefox-style | Firefox 126 |
| safari  | Safari suite  | —             | Safari 17.0 |
| edge    | Chrome suite  | Chrome 126    | Edge 126    |

### Example

```ts
const transport = new BunTransport({
  stealth: {
    fingerprint: "chrome",
  },
});
```

Stealth presets are applied per-request. Manual headers always take priority over preset values.

---

## Response API

`execute()` returns a plain `TransportResponse` object:

```ts
interface TransportResponse {
  status: number;
  statusText?: string;
  url?: string;
  headers: Readonly<Record<string, string | string[]>>;
  body: unknown;
}
```

### Body behavior

`body` is the raw native `ReadableStream` returned by Bun. Parse or consume it in the core layer, for example with `new Response(response.body).text()`.

---

## Internal utilities

### `fastGetHostname(url: string): string`

Fast hostname extraction from a URL with single-entry LRU cache. Handles `//`, `scheme://`, `user@host`, and port stripping.

### `resolveUrl(baseUrl: string, url: string): string`

Resolves a relative URL against a `baseUrl`. Absolute URLs are returned as-is.

### `normalizeHeaders(headers): Record<string, string>`

Normalizes headers: lowercases all keys, joins arrays (`;` for `cookie`, `,` for others).

---

## Shutdown

`BunTransport` supports resource cleanup:

```ts
await transport.close();
await transport.destroy();
```

Both methods clear:

- pending request queue
- cookie store
- cookie string cache
- response cache
- active request counter

---

## Notes

- Designed specifically for the **Bun runtime**, not Node.js.
- Uses `redirect: "manual"` for fetch requests.
- Minimal interference with request data; only headers, cookies, and signals are normalized or extended.
- `TransportRequest.body` is passed directly as `BodyInit | null`.

---

## License

MIT
