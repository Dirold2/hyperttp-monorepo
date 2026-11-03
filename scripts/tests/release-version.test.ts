import { test } from "node:test";
import assert from "node:assert/strict";
import { bumpVersion, parsePackageBump } from "../lib/release-version.ts";

for (const [from, bump, to] of [
  ["0.1.1", "patch", "0.1.2"],
  ["0.7.1", "patch", "0.7.2"],
  ["0.1.2", "minor", "0.2.0"],
  ["0.9.9", "major", "1.0.0"],
  ["1.9.9", "minor", "1.10.0"],
  ["1.0.99", "patch", "1.0.100"],
] as const) {
  test(`${from} ${bump} -> ${to}`, () => assert.equal(bumpVersion(from, bump), to));
}
for (const invalid of ["01.2.3", "1.2", "1.0.0-beta.1", "v1.0.0", "-1.2.3"]) {
  test(`rejects ${invalid}`, () => assert.throws(() => bumpVersion(invalid, "patch")));
}

test("per-package minor bump supports short and scoped names", () => {
  for (const name of ["voice", "@hyperttp/voice"]) {
    const [parsed, bump] = parsePackageBump(`${name}=minor`);
    assert.equal(parsed, name);
    assert.equal(bumpVersion("0.1.0", bump), "0.2.0");
  }
  for (const value of [undefined, "voice", "voice=", "=minor", "voice=other"])
    assert.throws(() => parsePackageBump(value), /requires/);
});
