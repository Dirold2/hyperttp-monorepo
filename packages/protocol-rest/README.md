# @hyperttp/protocol-rest

REST sender, receiver and public REST types for Hyperttp. This package replaces
`@hyperttp/sender-rest` and the REST implementation formerly built into core.
The legacy sender used protocol `http`; the canonical protocol identifier is `rest`.

```ts
import { HyperCore } from "@hyperttp/core";
import { RestProtocol } from "@hyperttp/protocol-rest";

const core = new HyperCore({ protocols: [RestProtocol] });
const response = await core.rest.get("https://example.com/users");
await core.destroy();
```

`HyperClient` from `hyperttp` registers REST automatically. Direct `HyperCore`
consumers must register `RestProtocol` explicitly. Importing types alone does
not register a protocol at runtime.

Exports include `RestProtocol`, `RestSender`, `RestReceiver`, `HttpMethod`,
`RestInput`, `RestRequestOptions`, `RestClientMethods`, `RestServerInput`,
`RestServerResponse`, `RestServerHandler`, `RestHeaders`, `HyperClientError`
and `TimeoutError`.

REST request/response and client method types augment `@hyperttp/types` through
module augmentation. This package has no runtime dependency on core.

## Server

```ts
await core.listen({
  protocol: "rest",
  port: 3000,
  handler: (request) => ({ status: 200, body: { path: request.path } }),
});
```

The receiver decodes requests and serializes responses; listening and transport
ownership remain with core. Application validation and authorization are not
provided by the protocol. Transport body limits, redirects and credentials are
transport responsibilities.

## Migration

- Replace REST imports from `@hyperttp/core` and `@hyperttp/core/rest` with
  `@hyperttp/protocol-rest`.
- Replace the legacy `@hyperttp/sender-rest` package with this package; change
  protocol `http` to `rest` and use the canonical `RestInput` request contract.
- Add `protocols: [RestProtocol]` when constructing `HyperCore` directly.
- REST-generated errors now belong to this package: import `TimeoutError` here,
  or inspect stable error codes rather than using core's class identity.

Core retains HTTP-capable fallback transports, but no REST sender/receiver.
This is a breaking change for direct core consumers. The local version has not
been raised automatically; choose the appropriate major release before publishing core.
