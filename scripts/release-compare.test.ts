import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDigest } from "./release-compare.ts";

test("ignores version/tooling/maps but detects public declarations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "release-compare-test-"));
  try {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "example", version: "0.1.0", scripts: { test: "old" } }),
    );
    await writeFile(
      join(dir, "index.d.ts"),
      "export type Value = string;\n//# sourceMappingURL=old.map\n",
    );
    const before = await packageDigest(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "new" }, version: "0.2.0", name: "example" }),
    );
    await writeFile(join(dir, "index.d.ts.map"), "different metadata");
    await writeFile(
      join(dir, "index.d.ts"),
      "export type Value = string;\n//# sourceMappingURL=new.map\n",
    );
    assert.equal(await packageDigest(dir), before);
    await writeFile(join(dir, "index.d.ts"), "export type Value = number;\n");
    assert.notEqual(await packageDigest(dir), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
