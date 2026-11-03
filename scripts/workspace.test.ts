import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { add, discover, ownsGitRoot, repositoryUrl, scan, status } from "./workspace.ts";

function git(dir: string, args: string[]) {
  const result = spawnSync("git", ["--no-pager", ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function repository(dir: string, name?: string) {
  await mkdir(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Workspace test"]);
  git(dir, ["config", "user.email", "workspace@example.invalid"]);
  if (name)
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name,
        version: "1.2.3",
        repository: "https://example.invalid/suggested.git",
      }),
    );
  else await mkdir(join(dir, "packages"));
  git(dir, ["add", "."]);
  git(dir, ["commit", "--allow-empty", "-m", "initial"]);
}
async function fixture(run: (base: string, temp: string) => Promise<void>) {
  const temp = await mkdtemp(join(tmpdir(), "workspace-test-"));
  try {
    const base = join(temp, "workspace");
    await repository(base);
    await run(base, temp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
async function output(run: () => Promise<void>) {
  const lines: string[] = [];
  const log = console.log;
  const warn = console.warn;
  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  console.warn = console.log;
  try {
    await run();
    return lines.join("\n");
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

test("repository transport validation allows local/HTTPS/SSH but rejects helpers and options", () => {
  assert.equal(repositoryUrl("https://example.com/a.git"), "https://example.com/a.git");
  assert.equal(repositoryUrl("ssh://git@example.com/a.git"), "ssh://git@example.com/a.git");
  assert.equal(repositoryUrl("git@example.com:a.git"), "git@example.com:a.git");
  assert.equal(repositoryUrl("./repo", "/tmp"), "/tmp/repo");
  assert.equal(repositoryUrl("file:///tmp/repo"), "/tmp/repo");
  for (const url of [
    "-x",
    "ext::command",
    "https://-option/a",
    "https://example.com/a\ncommand",
    "ftp://example.com/a",
    "file://remote/repo",
    "https://example.com/a?x=1",
  ])
    assert.throws(() => repositoryUrl(url));
});

test("scan distinguishes parent-owned directories and own Git roots without changing the index", async () => {
  await fixture(async (base, temp) => {
    const ordinary = join(base, "packages", "ordinary");
    await mkdir(ordinary);
    await writeFile(
      join(ordinary, "package.json"),
      JSON.stringify({
        name: "@test/ordinary",
        version: "2.0.0",
        repository: { url: "https://example.com/ordinary.git" },
      }),
    );
    await repository(join(base, "packages", "nested"), "@test/nested");
    await mkdir(join(base, "packages", "empty"));
    git(base, ["remote", "add", "origin", join(temp, "parent-origin")]);
    const before = git(base, ["status", "--porcelain"]);
    assert.equal((await discover(base)).length, 2);
    assert.equal(await ownsGitRoot(ordinary), false);
    assert.equal(await ownsGitRoot(join(base, "packages", "nested")), true);
    const text = await output(() => scan(base));
    assert.match(text, /ordinary directory/);
    assert.match(text, /own Git root/);
    assert.match(text, /Suggested package.repository URL: https:\/\/example.com\/ordinary.git/);
    const local = await output(() => status(false, base));
    assert.match(local, /local 2.0.0/);
    assert.doesNotMatch(local, /parent-origin|Remote __dist__|npm:/);
    assert.equal(git(base, ["status", "--porcelain"]), before);
  });
});

test("add validates a temporary clone, adds a local submodule, and refuses duplicate names/destinations", async () => {
  await fixture(async (base, temp) => {
    const source = join(temp, "source;literal");
    await repository(source, "@test/first");
    await output(() => add(source, undefined, base));
    assert.equal(await ownsGitRoot(join(base, "packages", "first")), true);
    assert.match(await readFile(join(base, ".gitmodules"), "utf8"), /packages\/first/);
    assert.match(git(base, ["ls-files", "--stage", "packages/first"]), /^160000 /);
    await assert.rejects(add(source, "other", base), /Package already exists/);
    const second = join(temp, "second");
    await repository(second, "@test/second");
    await mkdir(join(base, "packages", "reserved"));
    await writeFile(join(base, "packages", "reserved", "keep"), "untouched");
    await assert.rejects(add(second, "reserved", base), /Destination already exists/);
    assert.equal(await readFile(join(base, "packages", "reserved", "keep"), "utf8"), "untouched");
    await assert.rejects(add(second, "../escape", base), /single name/);
    await assert.rejects(add(second, "packages/first", base), /Destination already exists/);
  });
});

test("invalid package names fail before submodule registration", async () => {
  await fixture(async (base, temp) => {
    const source = join(temp, "invalid");
    await repository(source, "../escape");
    const before = git(base, ["status", "--porcelain"]);
    await assert.rejects(add(source, undefined, base), /Invalid package name/);
    assert.equal(git(base, ["status", "--porcelain"]), before);
  });
});

test("status reads branch, dirty state and ahead/behind in the package, not the parent", async () => {
  await fixture(async (base, temp) => {
    const source = join(temp, "source");
    await repository(source, "@test/source");
    await output(() => add(source, "source", base));
    const dir = join(base, "packages", "source");
    git(dir, ["config", "user.name", "Workspace test"]);
    git(dir, ["config", "user.email", "workspace@example.invalid"]);
    git(dir, ["commit", "--allow-empty", "-m", "ahead"]);
    await writeFile(join(dir, "untracked"), "dirty");
    const text = await output(() => status(false, base));
    assert.match(text, /main · dirty/);
    assert.match(text, /Upstream: origin\/main · ahead 1, behind 0/);
    assert.match(text, /Origin: .* · ahead 1, behind 0/);
  });
});

test("online failures are unknown, successful __dist__ lookup reports its version without fetching into the package", async () => {
  await fixture(async (base, temp) => {
    const source = join(temp, "source");
    await repository(source, "@test/source");
    git(source, ["checkout", "-b", "__dist__"]);
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({ name: "@test/source", version: "9.8.7" }),
    );
    git(source, ["add", "."]);
    git(source, ["commit", "-m", "dist"]);
    git(source, ["checkout", "main"]);
    await output(() => add(source, "source", base));
    const dir = join(base, "packages", "source");
    const before = git(dir, ["show-ref"]);
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    try {
      assert.match(await output(() => status(true, base)), /Remote __dist__: 9.8.7 · npm: unknown/);
      assert.equal(git(dir, ["show-ref"]), before);
      git(dir, ["remote", "set-url", "origin", join(temp, "missing")]);
      assert.match(
        await output(() => status(true, base)),
        /Remote __dist__: unknown · npm: unknown/,
      );
      git(dir, ["remote", "set-url", "origin", source]);
      git(source, ["branch", "-D", "__dist__"]);
      assert.match(
        await output(() => status(true, base)),
        /Remote __dist__: absent · npm: unknown/,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
