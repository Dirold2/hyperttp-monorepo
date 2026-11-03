# Tests

`protocol.test.ts` covers sender/receiver mapping, SDP and ICE validation, peer headers,
transport capability checks, timeout cleanup on success/failure, cancellation,
response normalization, and configured handlers.

Run `npm test`, `npm run test:typecheck`, and `npm run test:coverage`.
Tests use transport stubs; real WebRTC negotiation and interoperability remain the
responsibility of integration tests with a WebRTC-aware transport.
