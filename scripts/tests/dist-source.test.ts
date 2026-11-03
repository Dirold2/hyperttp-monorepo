import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspaceVersions } from "../lib/dist-source.ts";
test("resolves workspace dependencies without mutating the development manifest", () => {
  const input = {
    dependencies: { a: "workspace:^", b: "workspace:~", c: "workspace:*", d: "^2.0.0" },
    peerDependencies: { a: "workspace:^" },
  };
  const output = resolveWorkspaceVersions(input, { a: "0.5.1", b: "1.2.0", c: "3.0.0" });
  assert.deepEqual(output.dependencies, { a: "^0.5.1", b: "~1.2.0", c: "3.0.0", d: "^2.0.0" });
  assert.equal(input.dependencies.a, "workspace:^");
  assert.equal(output.peerDependencies.a, "^0.5.1");
  assert.throws(() => resolveWorkspaceVersions(input, {}), /Unknown workspace/);
});
