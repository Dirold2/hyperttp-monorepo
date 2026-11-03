# @hyperttp/types

> Universal, protocol-agnostic types for the Hyperttp ecosystem.

`@hyperttp/types` is a declaration-only package. It defines the contracts shared by the
Hyperttp runtime, protocol packages, and transports without depending on REST, gRPC, HTTP,
or any other concrete protocol.

## Architecture

```text
@hyperttp/types
  Universal contracts: IHyperCore, HyperSender, HyperReceiver, HyperProtocol,
  SendRequest, UniversalResponse, RequestContext, HyperTransport, and registries
          ▲
          │ module augmentation
          │
Protocol packages
  @hyperttp/rest, @hyperttp/grpc, ...
  Protocol semantics, input/output types, and convenience methods
          ▲
          │ use HyperTransport
          │
Transport packages
  Node, Bun, browser, or custom transports
  Protocol-agnostic network I/O
```

The package has three conceptual layers:

1. **Core types** — universal dispatch, lifecycle, plugin, retry, metrics, error, and
   transport contracts.
2. **Protocol packages** — protocol-specific senders, receivers, input/output types, and
   optional `IHyperCore` methods.
3. **Transports** — low-level I/O implementations. A transport executes normalized requests
   and returns raw responses; it does not parse protocol payloads.

## Installation

```sh
npm install @hyperttp/types
```

Runtime applications usually install this package transitively through `@hyperttp/core`.
Protocol and transport packages should declare it as a peer dependency when appropriate.

## Core contracts

### Client dispatch

`IHyperCore` exposes protocol-neutral dispatch and registry operations:

```ts
import type {
  IHyperCore,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";

async function request(core: IHyperCore) {
  const response: UniversalResponse = await core.send({
    protocol: "custom",
    input: { value: 42 },
  });

  return response.data;
}
```

The core also exposes runtime introspection methods:

```ts
await core.getProtocolName();
await core.getSenderName();
await core.getReceiverName();
await core.getTransportName();
```

These methods are part of the universal interface and return names supplied or resolved by
the runtime implementation.

### Protocol input inference

Protocol packages extend `ProtocolInputMap` and, optionally, `ProtocolMetadataMap`:

```ts
// inside a protocol package
import type { RestInput } from "./rest-input.js";
import type { RestMetadata } from "./rest-metadata.js";

declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    rest: RestInput;
  }

  interface ProtocolMetadataMap {
    rest: RestMetadata;
  }
}
```

After the augmentation is in scope, known protocol names can infer their input type when
calling `send()`:

```ts
core.send({
  protocol: "rest",
  input: {
    method: "GET",
    url: "/users",
  },
});
```

The generic fallback overload remains available for custom or dynamically loaded protocols.
Use `InferProtocolInput<P>` when a reusable helper needs to expose the same behavior.

### Server request/response inference

Server protocol packages use the corresponding server maps:

```ts
import type { RestServerInput, RestServerResponse } from "./server-types.js";

declare module "@hyperttp/types" {
  interface ProtocolServerRequestMap {
    rest: RestServerInput;
  }

  interface ProtocolServerResponseMap {
    rest: RestServerResponse;
  }
}
```

`HyperServerListenOptions` uses these maps as its defaults, so a known protocol can provide
typed server handlers without repeating generic parameters:

```ts
core.listen({
  protocol: "rest",
  handler(request, context) {
    request.path;
    request.query;
    request.body;

    return { status: 200, body: { ok: true } };
  },
});
```

The maps are intentionally empty in this package. Concrete request and response types belong
to the protocol package that owns their semantics.

## Senders and receivers

A protocol sender implements the three-phase client lifecycle:

```text
prepare → send → parse
```

A protocol receiver implements the three-phase server lifecycle:

```text
receive → handle → respond
```

A sender can optionally expose a dynamic method surface for protocol convenience methods:

```ts
const sender = {
  protocol: "rest",
  methods: {
    get,
    post,
    put,
  },
  prepare(request, context) {
    // normalize protocol input
  },
  send(prepared, transport, context) {
    // execute through HyperTransport
  },
  parse(raw, context) {
    // normalize the transport response
  },
};
```

`HyperMethod` and `HyperMethodSurface` describe this dynamic plugin boundary. The actual
method signatures remain protocol-specific and should be declared by the protocol package.

### Request finalization

`RequestContext` optionally exposes two runtime-provided hooks:

- `onSettled(callback)` registers a synchronous or asynchronous callback invoked once per
  logical request, after all blocking response and recovery handlers have completed.
  Registration during or after finalization is rejected. Callback errors are diagnostic
  only: they cannot change the finalized request outcome.
- `acceptFinalResponse(response)` accepts an already finalized response for a follower
  request without repeating blocking or background response transforms. It preserves the
  response data type and performs no network I/O.

Settlement callbacks receive the exported discriminated union `RequestOutcome`:
`{ readonly ok: true; readonly response: UniversalResponse }` or
`{ readonly ok: false; readonly error: unknown }`. Its `ok` discriminant describes whether
the logical request resolved or rejected, not the protocol-specific `response.ok` value.
Both hooks are optional so existing context implementations remain compatible; callers
must check availability before using them.

## Transport contract

`HyperTransport` is deliberately protocol-neutral:

```ts
import type {
  HyperTransport,
  TransportRequest,
  TransportResponse,
} from "@hyperttp/types";

const transport: HyperTransport = {
  async execute(request: TransportRequest): Promise<TransportResponse> {
    // Perform runtime-specific I/O here.
    throw new Error("not implemented");
  },
};
```

`TransportRequest` contains normalized headers and universal transport capabilities such as:

- `stream` — request streaming when supported;
- `followRedirects` — redirect handling when supported;
- `maxRedirects` — redirect limit when redirect handling is enabled.

Flexible protocol-level input should be normalized before it reaches the transport. For
example, a REST package may accept `Headers`, tuples, or a record, while the transport sees
the portable normalized record form.

### Shutdown lifecycle

Transports may implement both `close()` and `destroy()`:

- `close()` is the graceful shutdown operation and may wait for pending work;
- `destroy()` is the immediate shutdown operation.

The `graceful` argument of `IHyperCore.destroy()` is forwarded to the runtime lifecycle where
supported. Actual request draining is transport-dependent. During forced shutdown, runtimes
should prefer `destroy()` when it is available; during graceful shutdown, they should prefer
`close()`.

## Module augmentation

Protocol packages extend the core without adding protocol dependencies to this package:

```ts
// @hyperttp/rest/src/types.ts
import type { IHyperCore, HyperClientOptions } from "@hyperttp/types";
import type { RestInput, RestResponse } from "./types.js";

declare module "@hyperttp/types" {
  interface IHyperCore {
    get<T = unknown>(url: string): Promise<RestResponse<T>>;
  }

  interface HyperClientOptions {
    rest?: {
      baseUrl?: string;
    };
  }

  interface ProtocolInputMap {
    rest: RestInput;
  }

  interface ProtocolServerRequestMap {
    rest: RestInput;
  }
}
```

Module augmentation adds compile-time contracts only. The runtime package must provide the
actual sender, receiver, and convenience method implementations.

To activate an augmentation, import the protocol package or its augmentation entry point:

```ts
import "@hyperttp/core/rest";
```

## Creating a protocol package

1. Define protocol-specific input, output, metadata, and server request/response types.
2. Implement `HyperSender`, `HyperReceiver`, or both.
3. Extend `ProtocolInputMap` and any other applicable maps through module augmentation.
4. Add optional `IHyperCore` and `HyperClientOptions` extensions.
5. Expose the protocol sender/receiver and ensure the runtime registers them.
6. Keep protocol parsing and serialization in the protocol package, not in the transport.

## What does not belong here

The following remain outside `@hyperttp/types`:

- REST request and response models;
- HTTP methods and REST convenience APIs;
- fetch-specific or Node-specific transport options;
- JSON parsing options;
- protocol-specific error and metadata shapes.

They belong to their protocol or transport packages and can reach the core through module
augmentation where needed.

## Development

```sh
npm install
npm run build
npm run lint
npm run format:check
```

The package publishes generated declaration files from `dist/` and contains no runtime code.

## Public API reference

All declarations below are re-exported from `@hyperttp/types`.

### `IHyperCore` and `HyperProtocols`

`HyperProtocols` is an empty augmentation container for protocol namespaces such as
`core.rest` or `core.grpc`.

`IHyperCore extends HyperProtocols` exposes:

| Member | Type | Purpose |
| --- | --- | --- |
| `config` | `HyperClientOptions` | Immutable client configuration. |
| `getProtocolName(protocol?)` | `<P extends HyperProtocolName = HyperProtocolName>(protocol?: P) => Promise<string>` | Resolve the registered protocol name. |
| `getSenderName(protocol?)` | `<P extends HyperProtocolName = HyperProtocolName>(protocol?: P) => Promise<string>` | Resolve the sender name. |
| `getReceiverName(protocol?)` | `<P extends HyperProtocolName = HyperProtocolName>(protocol?: P) => Promise<string>` | Resolve the receiver name. |
| `getTransportName()` | `() => Promise<string>` | Resolve the transport name. |
| `send(request)` | Typed overloads | Dispatch a protocol request. |
| `getSender(protocol)` | `<P>(protocol: P) => AnyHyperSender<P> \| undefined` | Look up a sender. |
| `registerSender(sender)` | `<P>(sender: AnyHyperSender<P>) => this` | Register a sender. |
| `getReceiver(protocol)` | `<P>(protocol: P) => AnyHyperReceiver<P> \| undefined` | Look up a receiver. |
| `registerReceiver(receiver)` | `<P>(receiver: AnyHyperReceiver<P>) => this` | Register a receiver. |
| `getProtocol(protocol)` | `<P>(protocol: P) => AnyHyperProtocol<P> \| undefined` | Look up a protocol module. |
| `registerProtocol(protocol)` | `<P>(protocol: AnyHyperProtocol<P>) => this` | Register a protocol module. |
| `listen(options)` | `<P>(options: HyperServerListenOptions<P>) => Promise<TransportServer>` | Start a protocol server. |
| `use(plugin)` | `(plugin: HyperPlugin) => this` | Register a plugin. |
| `extend(options)` | `(options: Partial<HyperClientOptions>) => IHyperCore` | Create a client with merged options. |
| `create(options)` | `(options: Partial<HyperClientOptions>) => IHyperCore` | Create a new client. |
| `destroy(graceful?)` | `(graceful?: boolean) => Promise<void>` | Shut down the client. |

The primary `send()` overload is:

```ts
send<TOutput = unknown, P extends HyperProtocolName = HyperProtocolName>(
  request: SendRequest<InferProtocolInput<P>, P>,
): Promise<UniversalResponse<TOutput>>;
```

A generic fallback is also available:

```ts
send<TInput = unknown, TOutput = unknown, P extends HyperProtocolName = HyperProtocolName>(
  request: SendRequest<TInput, P>,
): Promise<UniversalResponse<TOutput>>;
```

### Sender types

#### `HyperProtocolName`

```ts
type HyperProtocolName = keyof ProtocolInputMap | (string & {});
```

It allows known augmented protocol keys as well as arbitrary custom strings.

#### `SenderProtocol` (deprecated)

```ts
/** @deprecated Use HyperProtocolName instead. */
type SenderProtocol = HyperProtocolName;
```

`HyperProtocolName` is the canonical protocol identifier shared by senders, receivers, protocol
modules, and transports. `SenderProtocol` remains available as a deprecated compatibility alias.

#### `ProtocolInputMap` and `ProtocolMetadataMap`

Empty interfaces intended for module augmentation:

```ts
declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    custom: CustomInput;
  }

  interface ProtocolMetadataMap {
    custom: CustomMetadata;
  }
}
```

Utility types:

```ts
type InferProtocolInput<P extends string> =
  P extends keyof ProtocolInputMap ? ProtocolInputMap[P] : unknown;

type InferProtocolMetadata<P extends string> =
  P extends keyof ProtocolMetadataMap
    ? ProtocolMetadataMap[P]
    : Record<string, unknown>;
```

#### `RequestContext`

Shared request lifecycle context:

| Property | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | Unique request identifier. |
| `startTime` | `number` | Request start timestamp. |
| `signal` | `AbortSignal \| undefined` | Cancellation signal. |
| `meta` | `Record<string, unknown>` | Shared lifecycle metadata. |
| `state` | `Record<string, unknown>` | Mutable state shared between phases. |

#### `SendRequest<TInput, P>`

Universal request envelope:

| Property | Type | Description |
| --- | --- | --- |
| `protocol` | `P` | Protocol identifier. |
| `input` | `TInput` or `InferProtocolInput<P>` | Protocol-specific input. |
| `signal` | `AbortSignal \| undefined` | Optional cancellation signal. |
| `metadata` | `Readonly<InferProtocolMetadata<P>> \| undefined` | Protocol metadata. |

#### `UniversalResponse<TOutput, TExtra>`

Normalized protocol-neutral response:

| Property | Type | Description |
| --- | --- | --- |
| `protocol` | `HyperProtocolName` | Protocol that handled the request. |
| `ok` | `boolean` | Protocol-defined success flag. |
| `status` | `number` | Numeric status. |
| `statusText` | `string \| undefined` | Status description. |
| `headers` | `Readonly<Record<string, string \| string[]>>` | Normalized response headers. |
| `url` | `string \| undefined` | Final response URL. |
| `data` | `TOutput` | Normalized response data. |
| `metadata` | `Readonly<TExtra> \| undefined` | Additional response metadata. |
| `raw` | `unknown \| undefined` | Raw response before normalization. |

#### `HyperMethod` and `HyperMethodSurface`

```ts
type HyperMethod = (...args: any[]) => unknown;
type HyperMethodSurface = Readonly<Record<string, HyperMethod>>;
```

These types describe the dynamic method boundary used by protocol senders. Concrete protocol
packages should provide the precise method signatures for their own APIs.

#### `HyperSender<TInput, TOutput, TPrepared, TRaw, P>`

A sender has the following members:

| Member | Type | Description |
| --- | --- | --- |
| `protocol` | `P` | Protocol served by the sender. |
| `methods` | `HyperMethodSurface \| undefined` | Optional convenience-method surface. |
| `prepare` | `(request: SendRequest<TInput, P>, ctx: RequestContext) => TPrepared` | Prepare the request. |
| `send` | `(prepared: TPrepared, transport: HyperTransport, ctx: RequestContext) => Promise<TRaw>` | Execute through a transport. |
| `parse` | `(raw: TRaw, ctx: RequestContext) => UniversalResponse<TOutput> \| Promise<UniversalResponse<TOutput>>` | Normalize the raw response. |

#### `AnyHyperSender<P>`

```ts
type AnyHyperSender<P extends HyperProtocolName = HyperProtocolName> =
  HyperSender<any, any, any, any, P>;
```

Use this compatibility alias at registration and configuration boundaries when the sender has
concrete, protocol-specific lifecycle types. It retains the protocol identifier while avoiding
strict function-variance incompatibilities caused by `unknown` input and raw types.

#### `SenderRegistry`

```ts
interface SenderRegistry {
  register<P extends HyperProtocolName>(sender: AnyHyperSender<P>): void;
  get<P extends HyperProtocolName>(protocol: P): AnyHyperSender<P> | undefined;
  has(protocol: HyperProtocolName): boolean;
  readonly size: number;
}
```

### Receiver and server types

#### Server protocol maps

`ProtocolServerRequestMap` and `ProtocolServerResponseMap` are empty augmentation points.
Their utility types resolve known entries or fall back to `unknown`:

```ts
type InferProtocolServerRequest<P extends string> =
  P extends keyof ProtocolServerRequestMap
    ? ProtocolServerRequestMap[P]
    : unknown;

type InferProtocolServerResponse<P extends string> =
  P extends keyof ProtocolServerResponseMap
    ? ProtocolServerResponseMap[P]
    : unknown;
```

#### `ServerRequestContext`

Extends `RequestContext` with transport-dependent server information:

| Property | Type |
| --- | --- |
| `connection` | `Readonly<Record<string, unknown>> \| undefined` |
| `peer` | `Readonly<Record<string, unknown>> \| undefined` |

#### `HyperServerListenOptions<P, TRequest, TResponse>`

| Property | Type |
| --- | --- |
| `protocol` | `P` |
| `host` | `string \| undefined` |
| `port` | `number \| undefined` |
| `signal` | `AbortSignal \| undefined` |
| `handler` | `(request: TRequest, ctx: ServerRequestContext) => TResponse \| Promise<TResponse> \| undefined` |

`TRequest` and `TResponse` default to the corresponding server protocol map entries.

#### `HyperReceiver<TRequest, TResponse, TRawRequest, TRawResponse, P>`

| Member | Type | Description |
| --- | --- | --- |
| `protocol` | `P` | Protocol served by the receiver. |
| `receive` | `(request: TRawRequest, ctx: ServerRequestContext) => TRequest \| Promise<TRequest>` | Parse raw transport input. |
| `handle` | `(request: TRequest, ctx: ServerRequestContext) => TResponse \| Promise<TResponse>` | Run application logic. |
| `respond` | `(response: TResponse, ctx: ServerRequestContext) => TRawResponse \| Promise<TRawResponse>` | Serialize the protocol response. |

#### `AnyHyperReceiver<P>`

```ts
type AnyHyperReceiver<P extends HyperProtocolName = HyperProtocolName> =
  HyperReceiver<any, any, any, any, P>;
```

`IHyperCore.registerReceiver()` and `BaseHyperClientOptions.receivers` use this alias to accept
receivers with concrete protocol request and response types.

#### `ReceiverRegistry`

`ReceiverRegistry` mirrors `SenderRegistry` with `register`, `get`, `has`, and readonly `size`.
Its `register()` and `get()` methods use `AnyHyperReceiver<P>` to preserve assignability of
receivers with concrete request, response, and raw transport types.

### Protocol modules

#### `HyperProtocolName`

```ts
type HyperProtocolName = keyof ProtocolInputMap | (string & {});
```

A protocol-neutral name for the shared protocol identifier used by sender, receiver, and
transport contracts. Use it in new cross-layer or server-side APIs instead of exposing the
sender-oriented alias directly.

#### `HyperProtocol<TInput, TOutput, TReq, TRes, P>`

A protocol module contains:

- `protocol: P`;
- an optional display `name`;
- a `sender`, a `receiver`, or both.

The `sender` and `receiver` slots preserve concrete prepared/raw transport types, so protocol
modules containing fully typed components remain assignable at registration boundaries.

#### `AnyHyperProtocol<P>`

```ts
type AnyHyperProtocol<P extends HyperProtocolName = HyperProtocolName> =
  HyperProtocol<any, any, any, any, P>;
```

This compatibility alias is used by `IHyperCore` registration and lookup methods,
`BaseHyperClientOptions.protocols`, and `ProtocolRegistry`. `ProtocolRegistry` provides
`register`, `get`, `has`, and readonly `size` methods.

### Client options

#### `LogLevel`

```ts
type LogLevel = "debug" | "info" | "warn" | "error";
```

#### `BaseHyperClientOptions` / `HyperClientOptions`

| Option | Type | Description |
| --- | --- | --- |
| `protocols` | `AnyHyperProtocol[] \| undefined` | Protocol modules to register. |
| `senders` | `AnyHyperSender[] \| undefined` | Senders to register. |
| `receivers` | `AnyHyperReceiver[] \| undefined` | Receivers to register. |
| `customTransport` | `HyperTransport \| undefined` | Custom low-level transport. |
| `customSender` | `AnyHyperSender \| undefined` | Custom sender. |
| `retry` | `Partial<RetryOptions> \| undefined` | Retry configuration overrides. |
| `logger` | `(level: LogLevel, message: string, meta?: unknown) => void` | Custom logger. |
| `verbose` | `boolean \| undefined` | Enable verbose logging. |
| `pluginDirs` | `string[] \| undefined` | Plugin directories. |
| `plugins` | `(HyperPlugin \| string)[] \| undefined` | Plugin instances or module paths. |
| `trackMetrics` | `boolean \| undefined` | Enable metrics collection. |

`HyperClientOptions` currently extends `BaseHyperClientOptions` and is an augmentation point for
protocol-specific configuration.

### Plugins

#### `PluginPhase` and `PluginExecutionMode`

```ts
type PluginPhase = "START" | "PREPARE" | "CONTROL" | "FORMAT" | "NETWORK" | "DATA";
type PluginExecutionMode = "blocking" | "background";
```

#### `PluginContext`

```ts
interface PluginContext {
  readonly config: HyperClientOptions;
  readonly core: IHyperCore;
}

interface ServerPluginContext extends ServerRequestContext {
  readonly protocol: HyperProtocolName;
}
```

`ServerPluginContext` is supplied to server lifecycle hooks. Its `protocol` identifies the
protocol bound by `listen()`, rather than a property inferred from raw transport input.

#### `PluginOnRequestResult<TInput, TOutput>`

```ts
type PluginOnRequestResult<TInput = unknown, TOutput = unknown> =
  | UniversalResponse<TOutput>
  | SendRequest<TInput>
  | void;
```

#### `HyperPlugin<TInput, TOutput>`

A plugin has `name`, optional `phase` and `mode`, and optional hooks:

| Hook | Signature |
| --- | --- |
| `enabled` | `(config: HyperClientOptions) => boolean` |
| `setup` | `(ctx: PluginContext) => void` |
| `onRequest` | `(req, ctx?, reqCtx?) => Promise<PluginOnRequestResult<TInput, TOutput>> \| PluginOnRequestResult<TInput, TOutput>` |
| `onResponse` | `(res, req?, ctx?, reqCtx?) => Promise<UniversalResponse<TOutput> \| void> \| UniversalResponse<TOutput> \| void` |
| `onError` | `(err, req?, ctx?, reqCtx?) => Promise<UniversalResponse<TOutput> \| void> \| UniversalResponse<TOutput> \| void` |

`reqCtx` is the per-request `RequestContext`, allowing plugins to share `state` and `meta`
across lifecycle phases.

#### Server plugin hooks

`ServerPluginContext extends ServerRequestContext` adds `readonly protocol: HyperProtocolName`.
The protocol comes from the `listen()` binding, not untrusted raw input. The same context
shares `state` and `meta` across the incoming request lifecycle.

`ServerRequestOutcome` is an exported discriminated union using a **raw transport response**,
not `UniversalResponse`:

```ts
type ServerRequestOutcome =
  | { readonly ok: true; readonly response: TransportResponse }
  | { readonly ok: false; readonly error: unknown };
```

`HyperPlugin` also provides these optional server hooks. All arguments are required when
invoking a hook; `MaybePromise<T>` below means `T | Promise<T>` (an internal type alias).

| Hook | Signature |
| --- | --- |
| `onServerRequest` | `(request: TransportRequest, ctx: PluginContext, requestCtx: ServerPluginContext) => MaybePromise<TransportRequest \| void>` |
| `onServerResponse` | `(response: TransportResponse, request: TransportRequest, ctx: PluginContext, requestCtx: ServerPluginContext) => MaybePromise<TransportResponse \| void>` |
| `onServerError` | `(error: unknown, request: TransportRequest, ctx: PluginContext, requestCtx: ServerPluginContext) => MaybePromise<TransportResponse \| void>` |
| `onServerSettled` | `(outcome: ServerRequestOutcome, request: TransportRequest, ctx: PluginContext, requestCtx: ServerPluginContext) => MaybePromise<void>` |

- Server hooks are always awaited/blocking, independently of the plugin's client `mode`.
  Every server hook runs in forward phase order:
  `START → PREPARE → CONTROL → FORMAT → NETWORK → DATA`, including response, error,
  and settlement hooks (no reverse unwinding).
- `onServerRequest` sees raw incoming input before `receiver.receive()` and may replace it.
- `onServerResponse` sees the serialized raw output after `receiver.respond()` and before
  it is handed to the transport; it may replace that output.
- All `onServerError` hooks are attempted; the first returned raw `TransportResponse`
  recovers the failure. Returning `void` does not recover it.
- `onServerSettled` runs exactly once per incoming request after response preparation or
  recovery, including an unrecovered failure. It does **not** confirm physical delivery
  to the peer. Settlement errors are diagnostic only and cannot change the outcome.
- Client hooks and client authentication are not automatically applied to incoming
  requests; implement server-side authentication explicitly in the server lifecycle.

### Retry and errors

#### `RetryOptions`

| Option | Type |
| --- | --- |
| `maxRetries` | `number \| undefined` |
| `baseDelay` | `number \| undefined` |
| `maxDelay` | `number \| undefined` |
| `jitter` | `boolean \| undefined` |

#### `HyperttpError<TReq, TRes>`

Extends `Error` with:

| Property | Type |
| --- | --- |
| `code` | `string` |
| `cause` | `unknown \| undefined` |
| `request` | `TReq \| undefined` |
| `response` | `TRes \| undefined` |
| `status` | `number \| undefined` |
| `statusCode` | `number \| undefined` |
| `meta` | `{ retryCount: number; isRetryable: boolean; duration?: number; timings?: { start: number; end?: number } } \| undefined` |

### Metrics

#### `HyperStats`

Optional built-in counters include `inflightRequests`, `cacheSize`, `queuedRequests`,
`activeQueue`, and `rateLimitHits`. The interface also has a string index signature for
custom metrics: `[key: string]: unknown`.

#### `RequestMetrics`

Required fields:

- `startTime`, `endTime`, and `duration` — request timing in milliseconds/timestamps;
- `bytesReceived` and `bytesSent`;
- `retries`;
- `cached`.

Optional fields are `statusCode`, `url`, `method`, `bodyHash`, `plugins`, and `stages`.
`stages` may contain `serializationMs`, `networkMs`, and `parsingMs`.

### Adapters

#### `HyperAdapter<T>`

```ts
interface HyperAdapter<T> {
  readonly name: string;
  readonly version?: string;
  adapt(core: IHyperCore): T;
}
```

Adapters translate `IHyperCore` into a third-party client shape such as Axios, Ky, or Got.

### Transport types

#### `TransportRequest`

| Property | Type |
| --- | --- |
| `method` | `string` |
| `url` | `string` |
| `headers` | `Readonly<Record<string, string \| string[]>>` |
| `body` | `unknown \| undefined` |
| `signal` | `AbortSignal \| undefined` |
| `protocol` | `HyperProtocolName` |
| `stream` | `boolean \| undefined` |
| `followRedirects` | `boolean \| undefined` |
| `maxRedirects` | `number \| undefined` |

Headers are already normalized at this layer. Protocol packages may accept more flexible
header input and normalize it before creating a `TransportRequest`.

#### `TransportResponse`

| Property | Type |
| --- | --- |
| `status` | `number` |
| `statusText` | `string \| undefined` |
| `headers` | `Readonly<Record<string, string \| string[]>>` |
| `url` | `string \| undefined` |
| `body` | `unknown` |

#### `TransportListenOptions`

| Property | Type |
| --- | --- |
| `host` | `string \| undefined` |
| `port` | `number \| undefined` |
| `signal` | `AbortSignal \| undefined` |
| `onRequest` | `(request: TransportRequest) => Promise<TransportResponse> \| TransportResponse \| undefined` |

`onError` is intentionally not part of this universal contract; transport-specific error
callbacks belong in the concrete transport package.

#### `TransportServer`

```ts
interface TransportServer {
  close(): Promise<void> | void;
}
```

#### `HyperTransport`

| Member | Type |
| --- | --- |
| `protocols` | `readonly HyperProtocolName[] \| undefined` |
| `supports` | `(protocol: HyperProtocolName) => boolean` (optional) |
| `execute` | `(request: TransportRequest) => Promise<TransportResponse>` |
| `listen` | `(options: TransportListenOptions) => Promise<TransportServer>` (optional) |
| `close` | `() => Promise<void> \| void` (optional) |
| `destroy` | `() => Promise<void> \| void` (optional) |

## Development

```sh
npm install
npm run build
npm run lint
npm run format:check
```

The package publishes generated declaration files from `dist/` and contains no runtime code.

## License

MIT
