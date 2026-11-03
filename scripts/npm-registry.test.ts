import { test } from "node:test";
import assert from "node:assert/strict";
import { containsVersion, waitForPublication } from "./npm-registry.ts";

for (const response of [
  "0.5.1",
  ["0.5.1"],
  { version: "0.5.1" },
  { "@hyperttp/types": ["0.5.1"] },
  { "@hyperttp/types@0.5.1": "0.5.1" },
]) {
  test(`recognizes npm version ${JSON.stringify(response)}`, () =>
    assert.equal(containsVersion(response, "@hyperttp/types", "0.5.1"), true));
}
test("does not accept a different package/version or arbitrary response", () => {
  for (const value of [null, {}, "0.5.0", ["0.5.0"], { name: "other", version: "0.5.1" }])
    assert.equal(containsVersion(value, "@hyperttp/types", "0.5.1"), false);
});
test("waits for registry visibility without republishing", async () => {
  let calls = 0;
  assert.equal(await waitForPublication(() => ++calls === 3, 3, 0), true);
  assert.equal(calls, 3);
  assert.equal(await waitForPublication(() => false, 2, 0), false);
});
