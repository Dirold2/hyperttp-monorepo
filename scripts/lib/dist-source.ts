import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { capture } from "./release.ts";
import { assertReleaseRepository, sourceSnapshot, copySource } from "./release-source.ts";
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
export async function sourceRelease(
  directory: string,
  version: string,
  dryRun = false,
  verifyOnly = false,
) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`Invalid version: ${version}`);
  await assertReleaseRepository(directory);
  const head = capture("git", ["rev-parse", "HEAD"], directory);
  const snapshot = await sourceSnapshot(directory);
  const originalManifest = await readFile(join(directory, "package.json"), "utf8");
  const manifest = JSON.parse(originalManifest);
  if (manifest.version !== version) throw new Error("Release version mismatch");
  const versions: Record<string, string> = {};
  for (const row of await packages())
    versions[row.pkg.name] = JSON.parse(
      await readFile(join(row.dir, "package.json"), "utf8"),
    ).version;
  const resolved = resolveWorkspaceVersions(manifest, versions);
  const url = capture("git", ["remote", "get-url", "origin"], directory);
  const tag = `v${version}`;
  const receiptFile = resolve(
    directory,
    capture("git", ["rev-parse", "--git-path", "hyperttp-source-release.json"], directory),
  );
  let previousCommit: string | undefined;
  try {
    const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
    if (receipt.url === url) previousCommit = receipt.commit;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const saveReceipt = async (commit: string) => {
    await mkdir(dirname(receiptFile), { recursive: true });
    await writeFile(receiptFile, JSON.stringify({ url, commit }) + "\n");
  };
  if (dryRun) return { head, tag };
  const temp = await mkdtemp(join(tmpdir(), "hyperttp-source-release-"));
  try {
    const repo = join(temp, "repo");
    capture("git", ["clone", "--no-hardlinks", "--", directory, repo]);
    capture("git", ["checkout", "--detach", head], repo);
    capture("git", ["remote", "set-url", "origin", url], repo);
    await copySource(directory, repo);
    await writeFile(join(repo, "package.json"), JSON.stringify(resolved, null, 2) + "\n");
    capture("git", ["add", "-A"], repo);
    const tree = capture("git", ["write-tree"], repo);
    const tagRef = `refs/tags/${tag}`;
    const remoteTag = capture("git", ["ls-remote", "origin", tagRef], repo);
    if (remoteTag) {
      capture("git", ["fetch", "origin", tagRef], repo);
      const existingTree = capture("git", ["rev-parse", "FETCH_HEAD^{tree}"], repo);
      if (existingTree !== tree)
        throw new Error(`Remote tag ${tag} has different contents; refusing replacement`);
      if ((await sourceSnapshot(directory)) !== snapshot)
        throw new Error("Source changed while preparing release");
      if (!verifyOnly) await saveReceipt(capture("git", ["rev-parse", "FETCH_HEAD^{}"], repo));
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
        if (remoteHead !== previousCommit) {
          const identityArgs = ["-c", `user.name=${match[1]}`, "-c", `user.email=${match[2]}`];
          // Verify remote source edits are already incorporated in the intended snapshot.
          // Normalize only package.json: release versions/resolved workspace ranges differ
          // intentionally; all other manifest changes must still be accounted for.
          const remoteManifest = JSON.parse(
            capture("git", ["show", `${remoteHead}:package.json`], repo),
          );
          const normalize = (pkg: Record<string, any>) => {
            const value = resolveWorkspaceVersions(pkg, versions);
            delete value.version;
            return JSON.stringify(value);
          };
          if (normalize(remoteManifest) !== normalize(resolved)) {
            const baseManifest = JSON.parse(capture("git", ["show", `${head}:package.json`], repo));
            if (normalize(remoteManifest) !== normalize(baseManifest))
              throw new Error(
                "Remote main contains source changes in package.json; reconcile it locally before release",
              );
          }
          const intended = capture(
            "git",
            [...identityArgs, "commit-tree", tree, "-p", head, "-m", "release snapshot"],
            repo,
          );
          // Replace the remote manifest in a temporary index/tree, not the source checkout.
          capture("git", ["read-tree", remoteHead], repo);
          capture("git", ["add", "package.json"], repo);
          const remoteTree = capture("git", ["write-tree"], repo);
          const normalizedRemote = capture(
            "git",
            [
              ...identityArgs,
              "commit-tree",
              remoteTree,
              "-p",
              remoteHead,
              "-m",
              "normalized remote manifest",
            ],
            repo,
          );
          let mergedTree: string;
          try {
            mergedTree = capture(
              "git",
              ["merge-tree", "--write-tree", intended, normalizedRemote],
              repo,
            ).split("\n")[0]!;
          } catch {
            throw new Error(
              "Remote main contains source changes conflicting with the release snapshot; reconcile it locally before release",
            );
          }
          if (mergedTree !== tree)
            throw new Error(
              "Remote main contains source changes absent from the release snapshot; reconcile it locally before release",
            );
          capture("git", ["read-tree", tree], repo);
        }

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
      (await sourceSnapshot(directory)) !== snapshot
    )
      throw new Error("Source changed while preparing release");
    if (verifyOnly) return { head, tag };
    capture(
      "git",
      ["push", "--atomic", "origin", "HEAD:refs/heads/main", `${tagRef}:${tagRef}`],
      repo,
    );
    await saveReceipt(capture("git", ["rev-parse", "HEAD"], repo));
    return { head, tag };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
