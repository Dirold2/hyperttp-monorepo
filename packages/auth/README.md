# `@hyperttp/auth`

Protocol-agnostic authentication plugin for **outgoing** Hyperttp requests.

It attaches dynamic credentials without requiring applications to copy tokens into every request. The plugin runs in the blocking `START` phase, so authentication can run before later crypto, cache, or inflight plugins.

> `@hyperttp/types@^0.4.2` exposes request lifecycle hooks only. This package does **not** authenticate inbound `core.listen()` requests or reject TCP connections. That requires a server-side hook in HyperCore/a protocol receiver.

## Install

```sh
bun add @hyperttp/auth @hyperttp/types
```

## REST credentials

### Bearer token

```ts
import { withAuth } from "@hyperttp/auth";

client.use(
  withAuth({
    allowedOrigins: ["https://api.example.com"],
    rest: {
      type: "bearer",
      getToken: () => session.accessToken,
      // Optional: a non-secret cache/inflight scope.
      getCacheKey: () => `tenant:${session.tenantId}:user:${session.userId}`,
    },
  }),
);
```

### Basic authentication

```ts
client.use(
  withAuth({
    allowedOrigins: ["https://api.example.com"],
    rest: {
      type: "basic",
      username: "service",
      getPassword: () => secretStore.get("service-password"),
    },
  }),
);
```

### API key

```ts
client.use(
  withAuth({
    allowedOrigins: ["https://api.example.com"],
    rest: {
      type: "api-key",
      location: "header", // or "query"
      name: "x-api-key",
      getValue: () => env.API_KEY,
    },
  }),
);
```

`rest` expects the protocol input to be an object with `headers` and, for a query API key, a string `url`. The original request is never mutated.

## Custom protocol adapter

The core auth plugin does not assume a request has HTTP headers. Use `apply` for gRPC metadata, signed protocols, or another transport-specific shape:

```ts
client.use(
  withAuth({
    protocol: "grpc",
    apply: async (request) => ({
      ...request,
      input: {
        ...request.input,
        metadata: {
          ...request.input.metadata,
          authorization: `Bearer ${await session.getAccessToken()}`,
        },
      },
    }),
  }),
);
```

Use `shouldAuthenticate(request, requestContext)` to selectively opt out of authentication.

## Origin and cache safety

- Built-in credentials require a non-empty HTTP(S) `allowedOrigins` list and apply only to REST. Only matching absolute URLs receive credentials; relative URLs are skipped. Origins cannot contain userinfo, paths, queries or fragments. Redirect safety must be enforced by the sender/transport, not this plugin.
- `getCacheKey()` is saved to `RequestContext.state` under `AUTH_IDENTITY_STATE_KEY`. Cache/inflight integrations must explicitly include this scope in their keys and exclude credentials. Never serialize the entire authenticated input into a cache key. Without a safe identity scope, skip caching/deduplication of authenticated requests. This package cannot change another plugin’s default keys.
- Never return access tokens, passwords, or API keys from `getCacheKey()`: `RequestContext.state` is intended for cross-plugin coordination and may be observed by logging or metrics integrations.
- The plugin does not log credential values.

## Core configuration

`withAuth()` loads `context.config.auth` during `setup()`. Explicit options passed to `withAuth(options)` take precedence. Without either source the plugin is inactive.

Register auth before crypto/cache/inflight plugins in the same phase: `START` alone does not guarantee ordering within that phase.

## Scope

The initial version provides credential attachment and identity propagation. Token refresh, single-flight refresh coordination, and protocol-specific server authentication are intentionally outside the current API.

### Conservative authentication defaults

`@hyperttp/auth` marks participating requests with the non-secret
`RequestContext.state["@hyperttp/auth.applied"]` boolean, including custom adapters.
Register auth before cache/inflight. Authenticated requests bypass default cache
and inflight keys. To opt in, supply a credential-free key and a stable non-secret
identity; cache and inflight refuse requests marked by auth without identity
even with a custom key. Do not return credentials from key callbacks. Manually supplied query
or nonstandard header credentials cannot be detected universally: disable these
plugins or configure safe scoped keys explicitly.
