# @hyperttp/retry

Opt-in retries for HyperCore/HyperClient outgoing requests.

```ts
import { createRetryPlugin } from "@hyperttp/retry";

client.use(createRetryPlugin());
```

Configure `retry` on the client before registration. The main `hyperttp` package
must have this plugin explicitly registered: configuration alone does not enable retries.
Alternatively use `withRetry(core, options)`. Installing twice is a no-op; the
first installation owns the policy. `enabled: false` prevents installation, but
does not uninstall an existing wrapper.

## Defaults

- Up to three retries (four sends), exponential backoff, full jitter, 5s maximum
  delay and 30s elapsed budget.
- Only REST GET, HEAD, OPTIONS, PUT and DELETE are eligible. POST, PATCH, QUERY
  and custom protocols are not retried by default.
- Retry responses 429, 500, 502, 503 and 504, and selected transient network errors.
  Application error responses retain their original status when retries end.
- Honor numeric or HTTP-date `Retry-After` response headers. If the requested wait
  exceeds the delay/budget limit, return the response instead of retrying too early.
- Abort signals are checked before attempts and interrupt pending backoff.
- Streams and unknown body classes are not replayed, even with a custom predicate.
  Supported REST bodies include plain objects/arrays, strings, byte buffers,
  Blob and URLSearchParams. Bodies must remain unchanged throughout the operation.
- Logs contain retry counts/delay only, not request URLs or transport error text.

## Explicit policy

`retry.shouldRetry({ request, attempt, response, error })` replaces the default
method/protocol/status policy. `attempt` is the one-based retry number. A custom
policy may opt into POST or a custom protocol only when the application can
ensure replay safety (for example, server-enforced idempotency keys).
Body safety, cancellation, attempt and elapsed limits remain enforced.
For custom protocols with opaque/nested streams, the policy must reject replay;
only conventional `input.body` is inspected by the built-in body guard.

## Lifecycle and limits

Each retry re-enters the complete `core.send()` pipeline, including auth, cache,
inflight and response/error hooks. Hooks must support repeated invocation.
The elapsed budget prevents new retries; it does not interrupt an active send.
Use a request AbortSignal for an end-to-end deadline. Transport errors are
propagated unchanged after retries, so application logging must redact them.
Streaming response retries require application-specific cleanup and are not
supported by the default policy.

This is an outgoing client policy, not server-side retry or authentication.

Core 3 uses per-Core plugin ownership. Prefer `pluginFactories: [createRetryPlugin]` when deriving cores; the legacy `RetryPlugin` singleton is deprecated and cannot be reused across independent cores. Retries still run the entire send pipeline for each attempt.
