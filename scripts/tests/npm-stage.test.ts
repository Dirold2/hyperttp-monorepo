import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { selectStage, verifyStage } from "../lib/npm-stage.ts";
const stage = {
  id: "12345678-1234-1234-1234-123456789abc",
  packageName: "@test/pkg",
  version: "0.1.1",
  shasum: "a".repeat(40),
};
test("selects only exact name/version and rejects ambiguity or malformed identity", () => {
  assert.equal(selectStage([stage], stage.packageName, stage.version), stage);
  assert.equal(selectStage([stage], stage.packageName, "0.1.2"), undefined);
  assert.throws(() => selectStage([stage, stage], stage.packageName, stage.version));
  assert.throws(() => selectStage([{ ...stage, id: "--bad" }], stage.packageName, stage.version));
  assert.throws(() => selectStage({}, stage.packageName, stage.version));
});
test("requires exact staged tarball hash before approval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "npm-stage-test-"));
  try {
    const archive = join(dir, "package.tgz");
    await writeFile(archive, "fixture");
    const matching = { ...stage, shasum: createHash("sha1").update("fixture").digest("hex") };
    await verifyStage(matching, archive);
    await assert.rejects(verifyStage(stage, archive), /differs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
