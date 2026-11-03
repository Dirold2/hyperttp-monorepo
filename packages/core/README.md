# @hyperttp/core

> Protocol-agnostic execution core for client and server communication.

**English** | [Русский](./lang/ru/README.md)

[![CI](https://github.com/IT-IF-OR/hyperttp-core/actions/workflows/ci.yml/badge.svg)](https://github.com/IT-IF-OR/hyperttp-core/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![npm downloads](https://img.shields.io/npm/dm/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@hyperttp/core)](https://bundlephobia.com/package/@hyperttp/core)
[![license](https://img.shields.io/npm/l/@hyperttp/core)](./LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

## Positioning

`@hyperttp/core` is a small orchestration kernel, not another wrapper around `fetch` and not a
batteries-included HTTP framework. It connects three independent extension points:

- **Protocols** define communication semantics. A protocol can send through a `HyperSender`,
  receive through a `HyperReceiver`, or implement both roles as a `HyperProtocol`.
- **Transports** own physical I/O. The current transport contract executes outgoing requests and can
  additionally listen for incoming requests.
- **Plugins** add client policy and explicit server lifecycle hooks without expanding the core.

The core owns dispatch, lifecycle, plugin execution and resource coordination. REST is included as
the baseline protocol; additional protocols, optimized transports and higher-level behavior live in
separate packages.

```text
Application
    │
    ├── Plugins: retry, cache, auth, tracing, metrics, logging, policy
    │
 HyperCore
    │
    ├── Protocol: prepare → send → parse
    │              receive → handle → respond
    │
    └── Transport: execute (client) / listen (server)
                   Node.js / Bun / Deno / Browser / custom runtime
```

This boundary is intentional. New client-side retries, caches, authentication strategies,
observability tools and other request policies should be plugins. New wire semantics should be
protocol packages. New I/O implementations should be transport packages.

> Looking for a preconfigured HTTP client? Use
> [`hyperttp`](https://www.npmjs.com/package/hyperttp), which composes the core with application-level
> plugins and defaults.

## Core properties

- Client and server orchestration.
- Protocol-independent request envelope and universal response shape.
- Client lifecycle: `prepare → send → parse`.
- Server lifecycle: `receive → handle → respond`.
- Per-protocol transport resolution and coordinated transport ownership.
- Blocking and background client plugin hooks, plus separate blocking server hooks.
- Stable request contexts and final settlement callbacks for resource cleanup.
- Runtime-aware transport selection with a browser-safe fetch fallback.
- Strict TypeScript contracts and module augmentation for typed protocol namespaces.
- No bundled runtime dependencies.

## Installation

```bash
npm install @hyperttp/core @hyperttp/types
```

Core requires `@hyperttp/types@^0.5.0`. Shared lifecycle and plugin contracts are exported
from that package, including `CorePluginFactory`, `RequestOutcome`, `ServerPluginContext`
and `ServerRequestOutcome`. Use `HyperProtocolName` for protocol identifiers;
`SenderProtocol` remains a deprecated compatibility alias.

Optimized transports are optional. Select releases compatible with the current contracts.
The built-in `FetchTransport` supports REST by default; it is not a universal fallback for
WebRTC, MQTT or WebSocket. Protocol packages and transport packages serve different roles.

## Client quick start

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore();

const response = await core.rest.get("https://example.com/users", {
  query: { page: 1 },
});

console.log(response.status);
console.log(response.data);

await core.destroy();
```

The same request can use the protocol-independent API:

```ts
const response = await core.send({
  protocol: "rest",
  input: {
    method: "GET",
    url: "https://example.com/users",
    query: { page: 1 },
  },
});
```

## Server quick start

A transport may also expose `listen()`. `HyperCore` connects it to the receiver side of the selected
protocol:

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore();

const server = await core.listen({
  protocol: "rest",
  host: "127.0.0.1",
  port: 3000,
  handler(request) {
    return {
      status: 200,
      body: {
        method: request.method,
        path: request.path,
      },
    };
  },
});

// Closes active servers and releases every transport owned by this core.
await core.destroy();
```

Protocols can be client-only, server-only or expose both roles. The current transport contract always
provides client `execute()` and can additionally provide server `listen()`.

Use `await server.close()` to close just this listener, or `await core.destroy()` to close
all listeners and release owned transports. Router methods such as `server.rest.get()`
and typed service injection belong to the high-level `hyperttp` package, not Core.

## Protocols

REST is the only protocol implemented inside the core. External protocol modules are loaded lazily:

| Protocol  | Package                        | Namespace                    |
| --------- | ------------------------------ | ---------------------------- |
| REST      | built in                       | `core.rest`                  |
| GraphQL   | `@hyperttp/protocol-graphql`   | `core.graphql`               |
| gRPC      | `@hyperttp/protocol-grpc`      | `core.grpc`                  |
| tRPC      | `@hyperttp/protocol-trpc`      | `core.trpc`                  |
| WebSocket | `@hyperttp/protocol-websocket` | `core.ws` / `core.websocket` |
| SSE       | `@hyperttp/protocol-sse`       | `core.sse`                   |
| MQTT      | `@hyperttp/protocol-mqtt`      | `core.mqtt`                  |
| WebRTC    | `@hyperttp/protocol-webrtc`    | `core.webrtc`                |

If an optional protocol package is missing, resolution fails with an installation hint instead of
silently selecting another protocol.

Explicitly registered senders expose their method namespace immediately, including registrations
after construction. Receiver-only modules can be used by `listen()` but do not provide client methods.
`registerProtocol()` replaces the whole module; use `registerSender()` or `registerReceiver()`
to replace one role while preserving the other. Generated flat methods are updated without deleting
user overrides. Names colliding with Core API or prototype-sensitive properties are rejected.

### Protocol roles

A unified protocol module can expose either or both roles:

```ts
const protocol = {
  protocol: "my-protocol",
  sender: mySender, // optional client role
  receiver: myReceiver, // optional server role
};

core.registerProtocol(protocol);
```

A sender translates protocol input into a transport request and parses the transport response. A
receiver translates an incoming transport request into protocol input and serializes the application
response.

Protocol packages can extend typed inputs and namespaces through `@hyperttp/types` module
augmentation:

```ts
declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    "my-protocol": MyProtocolInput;
  }

  interface HyperProtocols {
    "my-protocol": MyProtocolMethods;
  }

  interface ProtocolServerRequestMap {
    "my-protocol": MyServerRequest;
  }

  interface ProtocolServerResponseMap {
    "my-protocol": MyServerResponse;
  }
}
```

## Transports

A transport describes its client capabilities and optional server capability:

```ts
interface HyperTransport {
  execute(request: TransportRequest): Promise<TransportResponse>;
  listen?(options: TransportListenOptions): Promise<TransportServer>;
  close?(): Promise<void> | void;
  destroy?(): Promise<void> | void;
}
```

- `execute()` is the required client role.
- `listen()` is the optional server role.
- `protocols` or `supports()` declares protocol capabilities.
- The core resolves and retains transports per protocol and closes a shared instance only after its
  last owner releases it.

Runtime selection:

| Runtime        | Preferred package            | Fallback                  |
| -------------- | ---------------------------- | ------------------------- |
| Node.js        | `@hyperttp/transport-undici` | built-in `FetchTransport` |
| Bun            | `@hyperttp/transport-bun`    | built-in `FetchTransport` |
| Deno           | `@hyperttp/transport-deno`   | built-in `FetchTransport` |
| Browser / edge | custom transport             | built-in `FetchTransport` |

WebRTC, WebSocket and MQTT first try their specialized `@hyperttp/transport-webrtc`,
`@hyperttp/transport-websocket` and `@hyperttp/transport-mqtt` packages respectively.
Every candidate is checked for protocol support; runtime selection does not imply universal support.

Client and listen transport caches are separate and automatic transports are scoped by
configuration identity. A custom transport does not populate the default cache of other cores.
If the selected REST client transport has no `listen()`, the built-in server fallback is used
without replacing the client transport. That fallback uses dynamically loaded `node:http`:
browser-safe client imports do not imply browser server listening support.

A transport can also be supplied explicitly:

```ts
import { HyperCore } from "@hyperttp/core";
import { UndiciTransport } from "@hyperttp/transport-undici";

const core = new HyperCore({
  customTransport: new UndiciTransport(),
});
```

## Plugins

Plugins are the intended extension mechanism for client request behavior that does not belong to
protocol semantics or physical I/O. The current hooks run in the client `send()` lifecycle:

```ts
core.use({
  name: "request-logger",
  phase: "DATA",
  onRequest(request) {
    console.log("request", request.protocol);
  },
  onResponse(response) {
    console.log("response", response.status);
  },
  onError(error) {
    console.error(error);
  },
});
```

Hooks:

- `onRequest` can modify a request or return an early response.
- `onResponse` can inspect or replace a response.
- `onError` can recover by returning a response.
- `mode: "background"` detaches response-side work from the blocking path.
- `enabled(config)` controls registration.
- `setup(context)` initializes a plugin.

Stateful plugin instances belong to one core. Registering the same instance twice on that
core is idempotent; duplicate names and implicit cross-core reuse are rejected. Prefer
`pluginFactories: [() => withQueue(options), () => withInflight()]`: factories run once for
each constructor, `extend()` and `create()`. Explicit `plugins` still work; when deriving a
core, replace inherited stateful instances with fresh `plugins` or `plugins: []`.
A stateless plugin may opt into cross-core reuse with `shared: true`, but cannot define
`setup()`. This is a promise by its author that no request/core state is shared in closures.

Phases run START, PREPARE, CONTROL, FORMAT, NETWORK, DATA; an omitted phase uses START.
`onResponse` and `onError` are transformation/recovery hooks, not exactly-once cleanup hooks.
They retain their existing forward phase order. Each receives the envelope seen by its own
`onRequest` and a stable `RequestContext`. All error hooks are attempted despite recovery
or diagnostic failures. Recovered responses enter response processing unless response
processing already failed; failure during recovery processing is reported without another
recovery cycle.

Register mandatory resource cleanup with `requestContext.onSettled(callback)`. It runs
exactly once after blocking response/recovery processing, with `{ ok: true, response }` or
`{ ok: false, error }`. All callbacks are attempted; their errors are diagnostic only.
Callbacks cannot register more callbacks once settlement starts. Updated queue/inflight
plugins use this path: queue releases once and inflight followers receive the final outcome.
A follower calls `acceptFinalResponse(response)` to reuse the finalized result without
applying response transformations twice. Background work is not awaited for settlement.
Background response/header snapshots are shallow: nested bodies, streams and context remain
shared and must not be mutated.

Examples of functionality that belongs in plugins:

- retries and circuit breakers;
- caching and request deduplication;
- authentication and request signing;
- tracing, metrics and structured logging;
- rate limiting, concurrency control and scheduling;
- schema validation and application-specific policies.

## Server plugins

Client hooks do not run on incoming `listen()` requests. Register separate server hooks
with the same `core.use()` / `pluginFactories` API:

```ts
core.use({
  name: "server-headers",
  onServerResponse(response) {
    return {
      ...response,
      headers: { ...response.headers, "x-powered-by": "hyperttp" },
    };
  },
});

await core.listen({
  protocol: "rest",
  port: 3000,
  handler: () => ({ body: { ok: true } }),
});
```

Server pipeline:

```text
onServerRequest → receiver.receive → handler/receiver.handle
→ receiver.respond → onServerResponse → transport
```

- `onServerRequest` can replace the raw `TransportRequest` before decoding.
- `onServerResponse` can replace serialized `TransportResponse`, including headers/body,
  before transport transmission. Preserve the body/stream if only changing headers.
- `onServerError` observes failures; all error hooks run and the first returned raw response
  recovers. Recovery enters outgoing hooks unless those hooks already failed. Another error
  during recovered-response processing is propagated without another recovery cycle.
- `onServerSettled` runs once per incoming request with the final preparation outcome, even
  if other diagnostic/cleanup hooks throw. Use it for server cleanup, not client onSettled.

All server hooks are awaited, even on plugins declaring client `mode: "background"`.
They follow forward phase order with one snapshot per incoming request, sharing a stable
context with the listen-bound `protocol`, signal, state and metadata. Settlement means the
response is ready to hand to the transport, **not** that streaming finished or bytes reached
the peer. Transport write failures happen outside this hook boundary.

Outbound auth/cache/retry are not automatically server authorization, server caching or
response retries. A plugin must explicitly implement the relevant server hooks.

## Built-in REST protocol

The REST package exposes client and server roles through `RestProtocol`.

```ts
const getResponse = await core.rest.get("https://example.com/users", {
  query: { page: 1, tag: ["a", "b"] },
  headers: { accept: "application/json" },
  timeout: 5_000,
});

const postResponse = await core.rest.post("https://example.com/users", {
  name: "Ada",
});

const streamResponse = await core.rest.stream("https://example.com/events");
```

REST behavior includes:

- query serialization with repeated array parameters;
- header normalization accepting `Headers`, records and tuple arrays;
- JSON serialization for plain object and array request bodies;
- JSON, text and binary response handling;
- browser-safe UTF-8 request encoding with no required global `Buffer`;
- timeout and user abort propagation, retained through the response stream lifetime;
- unbuffered stream mode;
- binary request preservation and backpressure-aware server streaming;
- prototype-safe query dictionaries, including repeated keys;
- request decoding and response serialization for the server role.

The built-in server limits request bodies to 10 MiB by default. `maxBodyBytes` must be a
non-negative safe integer; zero allows only empty bodies. Custom transports enforce their
own limits. REST does not add application validation, authorization or a redirect credential
policy; redirect support and credential handling depend on the selected transport.

Core does not apply a client base URL; use absolute URLs with the built-in fetch transport.

REST-specific public types are available from `@hyperttp/core/rest`.

## Lifecycle

Core states are initializing, running, destroying and destroyed. `setup()` may register
protocols/plugins but cannot start sends/listens or acquire transports. `destroy()` rejects
new operations, awaits pending server startup/close and, in graceful mode, waits for accepted
client calls including settlement. Calls paused before dispatch may reject at the next state
check. Forced destroy delegates interruption to transport `destroy()` and does not await
client calls; a non-cooperative transport can leave them pending. Streams outlive the send
promise: their deadline/cancellation remain active until completion, cancellation or failure.
Do not await `destroy()` from an active request hook: graceful shutdown waits for that call.

```ts
const child = core.extend({ verbose: true }); // shares existing and pending client transport leases
const isolated = core.create({}); // independent transport lifecycle

await child.destroy();
await isolated.destroy();
await core.destroy();
```

- `extend()` creates a related core and shares existing transport ownership.
- `create()` creates an independent core and does not inherit `customTransport` by default.
- `destroy()` is idempotent, closes tracked servers and releases transports.
- `destroy(false)` requests forced shutdown where the transport supports it.

## Error handling

```ts
import { HyperClientError, TimeoutError } from "@hyperttp/core";

try {
  await core.rest.get("https://example.com/slow", { timeout: 1_000 });
} catch (error) {
  if (TimeoutError.isTimeoutError(error)) {
    console.error("Request timed out");
  } else if (HyperClientError.isHyperClientError(error)) {
    console.error(error.code, error.message);
  }
}
```

## Scope

The stable core is intentionally limited to:

1. protocol registration and dispatch;
2. transport resolution, sharing and shutdown;
3. client and server lifecycle orchestration;
4. plugin execution;
5. the baseline REST protocol and universal error contracts.

Feature growth should happen through plugins, protocol packages and transport packages. Keeping this
boundary small makes runtime behavior predictable and allows the core API to stabilize independently
from the ecosystem around it.

## Runtime support

- Node.js 20 and newer;
- current stable Bun;
- current stable Deno;
- modern browsers and edge runtimes with Fetch and Web Streams.

## Development

```bash
bun install --frozen-lockfile
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

The required order is `lint → typecheck → test → build`. CI also verifies browser bundling, runtime
smoke tests and installation of the generated npm tarball.

## License

MIT
