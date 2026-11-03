# @hyperttp/protocol-webrtc

A thin `HyperProtocol` adapter for the `"webrtc"` protocol. It maps typed client inputs to transport requests and incoming transport requests to an application handler. It is **not a session manager or a WebRTC transport**.

The package does not create `RTCPeerConnection` instances, negotiate connections, capture media, manage tracks, or open DataChannels. The application and its selected `HyperTransport` own those responsibilities. There is no WebRTC runtime implementation or runtime/`werift` usage in `src`.

## Requirements

- Node.js >= 20 for the package's development tooling.
- Compatible `@hyperttp/types` and TypeScript peer dependencies (see `package.json`). HyperCore is supplied by the host application, not implemented here.
- A `HyperTransport` that can execute requests for `"webrtc"`; receiving requests also requires the host's inbound transport/core wiring.
- **DOM types for TypeScript consumers**, including server-side consumers: public types reference `RTCIceServer`, `RTCSessionDescriptionInit`, and `RTCIceCandidateInit`. Include `"DOM"` alongside your chosen ECMAScript library in `compilerOptions.lib`, for example `["ES2022", "DOM"]`. This is a compile-time requirement, not a requirement to run a browser or install a WebRTC runtime.

## Protocol instances

`WebRtcProtocol` is the default singleton with a sender and a receiver without an application handler. Use the factory for an independently configured protocol:

```ts
import {
  createWebRtcProtocol,
  WebRtcProtocol,
  type WebRtcServerHandler,
} from "@hyperttp/protocol-webrtc";

const handler: WebRtcServerHandler = (request) => ({
  status: 200,
  payload: { received: request.payload },
});

const protocol = createWebRtcProtocol({ handler });
const clientProtocol = WebRtcProtocol;
```

`createWebRtcProtocol({ handler?: WebRtcServerHandler } = {})` creates a protocol with its own `WebRtcSender` and `WebRtcReceiver`. Register the chosen protocol and a suitable transport using your host core's API. The factory does not register a transport or start a listener. Calling the receiver's `handle()` without a handler throws; the default singleton is not an echo server.

## Client requests

The sender exposes these methods through the host core's `webrtc` namespace (`WebRtcClientMethods`):

| Method                                             | Input action  | Behavior                                                               |
| -------------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `connect(peerUrl, options?, signal?)`              | `connect`     | Dispatch a connection request.                                         |
| `receive(peerUrl, options?, signal?)`              | `stream`      | Request a stream; defaults `receiveAudio` to `true` unless overridden. |
| `stream(peerUrl, localStream, options?, signal?)`  | `stream`      | Pass an opaque local stream handle to the transport.                   |
| `dataChannel(peerUrl, payload, options?, signal?)` | `datachannel` | Pass a payload to the transport.                                       |

These methods dispatch through `core.send()` and return `UniversalResponse`; they do not return a peer session or guarantee that ICE negotiation has completed. `WebRtcLocalStream` is a structural handle with `getTracks()`, not a capture or track-ownership abstraction.

Signaling actions `offer`, `answer`, and `candidate` use the same request path; there are no dedicated convenience methods for them:

```ts
import type { IHyperCore } from "@hyperttp/types";
import type { WebRtcInput } from "@hyperttp/protocol-webrtc";

// Supplied by the application, with the protocol and transport already registered.
declare const core: IHyperCore;
declare const offer: RTCSessionDescriptionInit;

const response = await core.send<WebRtcInput, unknown, "webrtc">({
  protocol: "webrtc",
  input: {
    action: "offer",
    peerUrl: "https://example.com/signaling",
    sessionId: "call-123",
    offer,
    timeout: 5_000,
  },
});

console.log(response.status, response.data);
```

The URL is interpreted by the selected transport; it does not select an HTTP plugin automatically.

## Transport and signaling contract

`WebRtcTransportRequest extends TransportRequest` describes the WebRTC-specific request metadata. `prepare()` builds a POST-shaped request with `protocol: "webrtc"`, the peer URL, JSON content type, an action/payload body, signaling fields, and transport options such as `iceServers`, `localStream`, receive flags, and `channelLabel`.

The signaling contract carries `offer`, `answer`, `candidate`, and `sessionId` through the relevant client/server request and response types. `sessionId` is application-supplied correlation data, not a session allocated or tracked by this package. The adapter does not generate SDP, apply descriptions, buffer ICE candidates, or validate signaling state.

`send()` checks `transport.supports("webrtc")` **if the method exists** and rejects a transport that reports no support; otherwise it checks the optional `protocols` list and delegates to `transport.execute()`. A transport without `supports` is not rejected merely for omitting that optional method.

`parse()` places the transport body in `UniversalResponse.data`, preserves `raw`, and sets `ok` for status codes 200–299. A non-2xx transport response is represented as `ok: false`, not automatically thrown as an exception. Transport errors propagate.

The receiver maps incoming bodies to `WebRtcServerInput`, invokes the configured handler, and maps its result back to a transport response (default status 200 and JSON content type). Malformed bodies, unknown/missing actions, invalid descriptions/candidates, and ambiguous peer headers are rejected with `INVALID_WEBRTC_SIGNAL` (status 400). An already-aborted server context is rejected before calling the handler.

**`x-peer-id` is metadata, not authentication.** The receiver reads it as `peerId` (falling back to `"unknown"`); this does not verify the caller's identity. Authentication, authorization, payload validation, trusted identity binding, and replay protection belong to the application/transport boundary.

Cancellation uses an `AbortSignal`; positive timeouts produce a timeout signal. The transport must honor that signal. Neither aborting a request nor a timeout implies closing a peer connection or stopping tracks.

## Out of scope

- Peer-session storage, lifecycle events, retries, reconnects, and hangup coordination.
- SDP negotiation, glare handling, ICE buffering, and STUN/TURN provisioning.
- Media capture, track cleanup, RTP/SRTP processing, and physical DataChannel I/O.
- Signaling servers, browser adapters, and server WebRTC runtimes.

See [architecture notes](docs/architecture.md) and [test scope](tests/README.md).

## Development scripts

```bash
npm install
npm run build
npm run test
npm run test:typecheck
npm run lint
npm run format:check
```

