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

import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../lib/release.ts";
import { sourceRelease } from "../lib/dist-source.ts";
import {
  assertReleaseRepository,
  assertReleaseRepositories,
  sourceSnapshot,
} from "../lib/release-source.ts";

async function fixture(task: (repo: string, remote: string) => Promise<void>) {
  const temp = await mkdtemp(join(tmpdir(), "release-source-test-"));
  const repo = join(temp, "repo"),
    remote = join(temp, "remote.git");
  try {
    capture("git", ["init", "--bare", remote]);
    capture("git", ["init", "-b", "main", repo]);
    capture("git", ["config", "user.name", "Release Test"], repo);
    capture("git", ["config", "user.email", "test@example.invalid"], repo);
    await writeFile(join(repo, ".gitignore"), "dist/\n");
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(repo, "old.ts"), "old");
    capture("git", ["add", "."], repo);
    capture("git", ["commit", "-m", "initial"], repo);
    capture("git", ["remote", "add", "origin", remote], repo);
    capture("git", ["push", "origin", "main"], repo);
    await task(repo, remote);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test("publishes dirty source, additions and deletions in isolation; retries are idempotent", async () => {
  await fixture(async (repo, remote) => {
    const head = capture("git", ["rev-parse", "HEAD"], repo);
    const manifest = JSON.stringify({
      name: "test",
      version: "1.0.1",
      peerDependencies: { "@hyperttp/types": "workspace:^" },
    });
    await writeFile(join(repo, "package.json"), manifest);
    await rm(join(repo, "old.ts"));
    await writeFile(join(repo, "new.ts"), "new source");
    const before = await sourceSnapshot(repo);
    const index = capture("git", ["write-tree"], repo);
    await sourceRelease(repo, "1.0.1");
    assert.equal(capture("git", ["show", "main:new.ts"], remote), "new source");
    assert.throws(() => capture("git", ["show", "main:old.ts"], remote));
    const published = JSON.parse(capture("git", ["show", "main:package.json"], remote));
    assert.match(published.peerDependencies["@hyperttp/types"], /^\^\d+\.\d+\.\d+$/);
    assert.equal(
      capture("git", ["log", "-1", "--format=%s", "main"], remote),
      "chore: release v1.0.1",
    );
    assert.equal(
      capture("git", ["rev-parse", "main"], remote),
      capture("git", ["rev-parse", "v1.0.1^{}"], remote),
    );
    await sourceRelease(repo, "1.0.1");
    assert.equal(await sourceSnapshot(repo), before);
    assert.equal(capture("git", ["rev-parse", "HEAD"], repo), head);
    assert.equal(capture("git", ["write-tree"], repo), index);
    assert.equal(await readFile(join(repo, "package.json"), "utf8"), manifest);
    await writeFile(join(repo, "new.ts"), "different");
    await assert.rejects(sourceRelease(repo, "1.0.1"), /different contents/);
  });
});

test("refuses unfinished Git operations and detects new source edits", async () => {
  await fixture(async (repo) => {
    const before = await sourceSnapshot(repo);
    await writeFile(join(repo, "untracked.ts"), "new");
    assert.notEqual(await sourceSnapshot(repo), before);
    const marker = capture("git", ["rev-parse", "--git-path", "MERGE_HEAD"], repo);
    await writeFile(join(repo, marker), capture("git", ["rev-parse", "HEAD"], repo));
    await assert.rejects(assertReleaseRepository(repo), /Finish Git operation/);
  });
});

test("refuses overwriting source updates on remote main", async () => {
  await fixture(async (repo, remote) => {
    const clone = join(repo, "..", "other");
    capture("git", ["clone", "-b", "main", remote, clone]);
    await writeFile(join(clone, "other.ts"), "remote change");
    capture("git", ["add", "."], clone);
    capture(
      "git",
      [
        "-c",
        "user.name=Other",
        "-c",
        "user.email=other@example.invalid",
        "commit",
        "-m",
        "remote update",
      ],
      clone,
    );
    capture("git", ["push", "origin", "main"], clone);
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "test", version: "1.0.1" }));
    await assert.rejects(sourceRelease(repo, "1.0.1"), /Remote main contains source changes/);
  });
});

test("preflight aggregates all ordinary package directories without modifying them", async () => {
  await fixture(async (repo) => {
    const first = join(repo, "one"),
      second = join(repo, "two");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(first);
    await mkdir(second);
    await assert.rejects(
      assertReleaseRepositories([
        { short: "one", dir: first },
        { short: "two", dir: second },
      ]),
      (error: Error) => /one:/.test(error.message) && /two:/.test(error.message),
    );
    await assertReleaseRepositories([{ short: "valid", dir: repo }]);
  });
});
