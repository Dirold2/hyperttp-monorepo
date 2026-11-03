import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { capture } from "./release.ts";
import { packages } from "../workspaces.ts";

export function resolveWorkspaceVersions(
  manifest: Record<string, any>,
  versions: Record<string, string>,
) {
  const result = structuredClone(manifest);
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, range] of Object.entries(result[field] ?? {})) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
      const version = versions[name];
      if (!version) throw new Error(`Unknown workspace dependency: ${name}`);
      const suffix = range.slice("workspace:".length);
      if (!["^", "~", "*"].includes(suffix))
        throw new Error(`Unsupported workspace range: ${name} ${range}`);
      result[field][name] = suffix === "*" ? version : `${suffix}${version}`;
    }
  }
  return result;
}

/** Builds a source release commit in isolation; local workspace ranges are untouched. */
export async function sourceRelease(directory: string, version: string, dryRun = false) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`Invalid version: ${version}`);
  if (resolve(capture("git", ["rev-parse", "--show-toplevel"], directory)) !== resolve(directory))
    throw new Error("dist requires an independent package repository");
  if (capture("git", ["branch", "--show-current"], directory) !== "main")
    throw new Error("dist requires branch main");
  const head = capture("git", ["rev-parse", "HEAD"], directory);
  const status = capture("git", ["status", "--porcelain"], directory);
  if (
    status
      .split("\n")
      .filter(Boolean)
      .some((line) => line.slice(3) !== "package.json")
  )
    throw new Error("Commit source changes before dist (only release version may be uncommitted)");
  const originalManifest = await readFile(join(directory, "package.json"), "utf8");
  const manifest = JSON.parse(originalManifest);
  const committed = JSON.parse(capture("git", ["show", "HEAD:package.json"], directory));
  const withoutVersion = (pkg: Record<string, unknown>) => {
    const copy = { ...pkg };
    delete copy.version;
    return JSON.stringify(copy);
  };
  if (withoutVersion(manifest) !== withoutVersion(committed))
    throw new Error("Commit package.json changes other than release version before dist");
  if (manifest.version !== version) throw new Error("Release version mismatch");
  const versions: Record<string, string> = {};
  for (const row of await packages())
    versions[row.pkg.name] = JSON.parse(
      await readFile(join(row.dir, "package.json"), "utf8"),
    ).version;
  const resolved = resolveWorkspaceVersions(manifest, versions);
  const url = capture("git", ["remote", "get-url", "origin"], directory);
  const tag = `v${version}`;
  if (dryRun) return { head, tag };
  const temp = await mkdtemp(join(tmpdir(), "hyperttp-source-release-"));
  try {
    const repo = join(temp, "repo");
    capture("git", ["clone", "--no-hardlinks", "--", directory, repo]);
    capture("git", ["checkout", "--detach", head], repo);
    capture("git", ["remote", "set-url", "origin", url], repo);
    await writeFile(join(repo, "package.json"), JSON.stringify(resolved, null, 2) + "\n");
    capture("git", ["add", "package.json"], repo);
    const tree = capture("git", ["write-tree"], repo);
    const tagRef = `refs/tags/${tag}`;
    const remoteTag = capture("git", ["ls-remote", "origin", tagRef], repo);
    if (remoteTag) {
      capture("git", ["fetch", "origin", tagRef], repo);
      const existingTree = capture("git", ["rev-parse", "FETCH_HEAD^{tree}"], repo);
      if (existingTree !== tree)
        throw new Error(`Remote tag ${tag} has different contents; refusing replacement`);
      return { head, tag };
    }
    const main = capture("git", ["ls-remote", "origin", "refs/heads/main"], repo);
    if (main) {
      capture("git", ["fetch", "origin", "refs/heads/main"], repo);
      const remoteHead = capture("git", ["rev-parse", "FETCH_HEAD"], repo);
      // Merge parent keeps subsequent releases fast-forward while preserving local workspace history.
      if (remoteHead !== head) {
        const identity = capture("git", ["var", "GIT_AUTHOR_IDENT"], directory);
        const match = /^(.*) <([^>]+)>/.exec(identity)!;
        // Refuse unrelated source history, rather than replacing an independent main.
        capture("git", ["merge-base", head, remoteHead], repo);
        const commit = capture(
          "git",
          [
            "-c",
            `user.name=${match[1]}`,
            "-c",
            `user.email=${match[2]}`,
            "commit-tree",
            tree,
            "-p",
            head,
            "-p",
            remoteHead,
            "-m",
            `chore: release ${tag}`,
          ],
          repo,
        );
        capture("git", ["reset", "--hard", commit], repo);
      }
    }
    if (capture("git", ["rev-parse", "HEAD^{tree}"], repo) !== tree) {
      const identity = capture("git", ["var", "GIT_AUTHOR_IDENT"], directory);
      const match = /^(.*) <([^>]+)>/.exec(identity)!;
      capture(
        "git",
        [
          "-c",
          `user.name=${match[1]}`,
          "-c",
          `user.email=${match[2]}`,
          "commit",
          "-m",
          `chore: release ${tag}`,
        ],
        repo,
      );
    }
    const identity = /^(.*) <([^>]+)>/.exec(
      capture("git", ["var", "GIT_AUTHOR_IDENT"], directory),
    )!;
    capture(
      "git",
      [
        "-c",
        `user.name=${identity[1]}`,
        "-c",
        `user.email=${identity[2]}`,
        "tag",
        "-a",
        tag,
        "-m",
        tag,
      ],
      repo,
    );
    if (
      capture("git", ["rev-parse", "HEAD"], directory) !== head ||
      (await readFile(join(directory, "package.json"), "utf8")) !== originalManifest
    )
      throw new Error("Source changed while preparing release");
    capture(
      "git",
      ["push", "--atomic", "origin", "HEAD:refs/heads/main", `${tagRef}:${tagRef}`],
      repo,
    );
    return { head, tag };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
