import assert from "node:assert/strict";
import { HyperCore } from "../dist/index.js";
import { withInflight } from "../../hyperttp-inflight/dist/index.js";
import { withQueue } from "../../hyperttp-queue/dist/index.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Uses built package entry points and mock I/O only. No servers or external requests.
for (const scenario of ["success", "response-error", "recovery"]) {
  const started = deferred();
  const release = deferred();
  const followerJoined = deferred();
  let sends = 0;
  let transformed = 0;
  let predicates = 0;
  const failure = new Error("late response failure");
  const core = new HyperCore(
    {
      pluginFactories: [
        () => withQueue({ maxConcurrent: 2 }),
        () =>
          withInflight({
            shouldDedupe() {
              if (++predicates === 2) followerJoined.resolve();
              return true;
            },
          }),
        () => ({
          name: "replace-envelope",
          phase: "FORMAT",
          onRequest: (request) => ({ ...request }),
        }),
        () => ({
          name: "final-transform",
          phase: "DATA",
          onError: () =>
            scenario === "recovery"
              ? { protocol: "rest", ok: true, status: 200, headers: {}, data: "recovered" }
              : undefined,
          onResponse(response) {
            transformed++;
            if (scenario === "response-error") throw failure;
            return { ...response, data: `final:${response.data}` };
          },
        }),
      ],
    },
    {
      async execute() {
        sends++;
        started.resolve();
        await release.promise;
        if (scenario === "recovery") throw new Error("mock I/O failure");
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: new TextEncoder().encode("raw"),
        };
      },
    },
  );
  try {
    const primary = core.rest.get("https://example.invalid/local-only");
    await started.promise;
    const follower = core.rest.get("https://example.invalid/local-only");
    await followerJoined.promise;
    // Resume after the async inflight onRequest has attached its waiter.
    await Promise.resolve();
    release.resolve();
    const results = await Promise.allSettled([primary, follower]);
    assert.equal(sends, 1, scenario);
    assert.equal(transformed, 1, scenario);
    if (scenario === "response-error") {
      for (const result of results) {
        assert.equal(result.status, "rejected");
        assert.equal(result.reason, failure);
      }
    } else {
      for (const result of results) {
        assert.equal(result.status, "fulfilled");
        assert.equal(result.value.data, scenario === "recovery" ? "final:recovered" : "final:raw");
      }
    }
    // A fresh call must not join a stale flight or wait on leaked queue slots.
    await core.rest.get("https://example.invalid/local-only").catch((error) => {
      assert.equal(scenario, "response-error");
      assert.equal(error, failure);
    });
    assert.equal(sends, 2);
    console.log(`${scenario}: final settlement, follower and cleanup OK`);
  } finally {
    release.resolve();
    await core.destroy();
  }
}

// Execute browser-sensitive encoding with Buffer absent, rather than only bundling.
const previousBuffer = globalThis.Buffer;
try {
  globalThis.Buffer = undefined;
  const core = new HyperCore(
    {},
    {
      async execute(request) {
        assert.equal(new TextDecoder().decode(request.body), '{"text":"Привет 🌍"}');
        return { status: 204, headers: {}, body: new Uint8Array() };
      },
    },
  );
  try {
    await core.rest.post("https://example.invalid/local-only", { text: "Привет 🌍" });
  } finally {
    await core.destroy();
  }
  console.log("UTF-8 encoding without Buffer: OK");
} finally {
  globalThis.Buffer = previousBuffer;
}
