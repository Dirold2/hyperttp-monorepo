import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/subtree.mjs [--dry-run] [package ...]\nDefaults: all packages, remote branch monorepo. Only committed changes are exported.");
  process.exit(0);
}
const dryRun = args.includes("--dry-run");
const requested = args.filter(arg => arg !== "--dry-run");
const rows = JSON.parse(readFileSync(new URL("../migration.json", import.meta.url), "utf8"));
for (const name of requested) {
  if (!rows.some(row => row.directory === name || row.name === name)) {
    throw new Error(`Unknown package or option: ${name}`);
  }
}
const selected = rows.filter(row => !requested.length || requested.includes(row.directory) || requested.includes(row.name));
function git(args, allowed = [0]) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes -o ConnectTimeout=15" },
  });
  if (result.error || !allowed.includes(result.status)) {
    throw new Error(result.error?.message || result.stderr.trim() || `git ${args.join(" ")} exited ${result.status}`);
  }
  return { output: result.stdout.trim(), status: result.status };
}

// Freeze the source snapshot so concurrent commits cannot change the export midway.
const head = git(["rev-parse", "HEAD"]).output;
const dirty = git(["status", "--porcelain", "--untracked-files=normal"]).output;
if (dirty) console.warn("Warning: uncommitted changes are not exported (using HEAD).");
let failed = 0;
for (const row of selected) {
  const remote = row.directory;
  const ref = "refs/heads/monorepo";
  try {
    git(["remote", "get-url", remote]);
    const local = git(["subtree", "split", `--prefix=packages/${row.directory}`, head]).output;
    const listing = git(["ls-remote", "--exit-code", remote, ref], [0, 2]);
    const advertised = listing.status === 2 ? null : listing.output.split(/\s+/)[0];
    if (advertised === local) {
      console.log(`[skip] ${remote}: no changes`);
      continue;
    }
    if (advertised) {
      git(["fetch", "--no-tags", remote, ref]);
      const previous = git(["rev-parse", "FETCH_HEAD"]).output;
      if (git(["merge-base", "--is-ancestor", previous, local], [0, 1]).status !== 0) {
        throw new Error("Remote monorepo has divergent history; refusing to overwrite it.");
      }
      // A commit can change history without changing the package's final contents.
      if (git(["rev-parse", `${previous}^{tree}`]).output === git(["rev-parse", `${local}^{tree}`]).output) {
        console.log(`[skip] ${remote}: no content changes`);
        continue;
      }
    }
    if (dryRun) {
      console.log(`[would push] ${remote}: ${local} -> monorepo${advertised ? "" : " (new branch)"}`);
    } else {
      // Normal push rejects concurrent non-fast-forward updates. Never force push.
      git(["push", remote, `${local}:${ref}`]);
      console.log(`[pushed] ${remote}: monorepo`);
    }
  } catch (error) {
    failed++;
    console.error(`[error] ${remote}: ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
