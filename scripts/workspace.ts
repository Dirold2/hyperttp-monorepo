import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cli, logDetail, logStep, logWarn, summaryBox } from "./lib/format.ts";
import { root } from "./workspaces.ts";

type Package = { name: string; version?: string; repository?: string | { url?: string } };
export type Row = { dir: string; short: string; pkg: Package };
const unknown = "unknown";

function git(cwd: string, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
  // Explicit cwd must not be redirected to a caller's repository or index.
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ])
    delete env[key];
  const result = spawnSync("git", ["--no-pager", ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr.trim() || `git exited ${result.status}`);
  return result.stdout.trim();
}
function attempt(cwd: string, args: string[]) {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}
async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function validName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
  );
}
async function manifest(dir: string): Promise<Package> {
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  if (!pkg || !validName(pkg.name)) throw new Error(`Invalid package name in ${dir}/package.json`);
  return pkg;
}
export async function discover(base = root): Promise<Row[]> {
  const rows: Row[] = [];
  for (const entry of await readdir(join(base, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(base, "packages", entry.name);
    if (!(await exists(join(dir, "package.json")))) continue;
    rows.push({ dir, short: entry.name, pkg: await manifest(dir) });
  }
  return rows.sort((a, b) => a.short.localeCompare(b.short));
}
export async function ownsGitRoot(dir: string) {
  const top = attempt(dir, ["rev-parse", "--show-toplevel"]);
  return top !== undefined && (await realpath(top)) === (await realpath(dir));
}

// Only Git's ordinary HTTPS, SSH, and filesystem transports are accepted, not helpers.
export function repositoryUrl(input: string, base = root): string {
  if (
    !input ||
    input.startsWith("-") ||
    Array.from(input).some((char) => {
      const code = char.codePointAt(0)!;
      return code <= 0x20 || code === 0x7f;
    })
  )
    throw new Error("Invalid repository URL");
  if (/^(https|ssh|file):\/\//.test(input)) {
    const url = new URL(input);
    if (
      url.search ||
      url.hash ||
      (url.protocol !== "file:" && (!url.hostname || url.hostname.startsWith("-")))
    )
      throw new Error("Invalid repository URL");
    if (url.protocol === "file:") {
      if (url.hostname && url.hostname !== "localhost")
        throw new Error("Only local file URLs are allowed");
      return fileURLToPath(url);
    }
    return input;
  }
  if (input.includes("://")) throw new Error("Unsupported repository transport");
  if (/^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*:[^:]+$/.test(input)) return input;
  if (input.includes(":")) throw new Error("Unsupported repository transport");
  return isAbsolute(input) ? input : resolve(base, input);
}
function directoryName(input: string) {
  const short = input.startsWith("packages/") ? input.slice(9) : input;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(short))
    throw new Error("Directory must be a single name under packages/");
  return short;
}
export async function add(url: string, directory?: string, base = root) {
  const source = repositoryUrl(url, base);
  if (directory !== undefined) directoryName(directory);
  const temporary = await mkdtemp(join(tmpdir(), "hyperttp-workspace-"));
  try {
    const checkout = join(temporary, "checkout");
    git(temporary, ["clone", "--", source, checkout]);
    const pkg = await manifest(checkout);
    const short = directoryName(directory ?? pkg.name.split("/").at(-1)!);
    const packagesDir = join(base, "packages");
    if ((await lstat(packagesDir)).isSymbolicLink())
      throw new Error("packages/ must not be a symlink");
    const destination = join(packagesDir, short);
    const rows = await discover(base);
    if (rows.some((row) => row.pkg.name === pkg.name))
      throw new Error(`Package already exists: ${pkg.name}`);
    if (await exists(destination)) throw new Error(`Destination already exists: packages/${short}`);
    if (!(await ownsGitRoot(base))) throw new Error("Workspace must be its own Git root");
    const registered = attempt(base, [
      "config",
      "--file",
      ".gitmodules",
      "--get-regexp",
      "^submodule\\..*\\.path$",
    ]);
    if (
      registered
        ?.split("\n")
        .some((line) => line.slice(line.indexOf(" ") + 1) === `packages/${short}`)
    )
      throw new Error(`Submodule already registered: packages/${short}`);
    // Never force or reuse a directory. Git also refuses tracked destinations.
    if (await exists(destination)) throw new Error(`Destination already exists: packages/${short}`);
    git(base, [
      ...(isAbsolute(source) ? ["-c", "protocol.file.allow=always"] : []),
      "submodule",
      "add",
      "--",
      source,
      `packages/${short}`,
    ]);
    logStep(`Added ${pkg.name} at packages/${short}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function scan(base = root) {
  const rows = await discover(base);
  for (const row of rows) {
    const own = await ownsGitRoot(row.dir);
    logStep(
      `${row.short} · ${row.pkg.name} · ${own ? "own Git root" : "ordinary directory (no own Git root)"}`,
    );
    const declared =
      typeof row.pkg.repository === "string" ? row.pkg.repository : row.pkg.repository?.url;
    const repository =
      (own ? attempt(row.dir, ["remote", "get-url", "origin"]) : undefined) || declared;
    if (repository) logDetail(`Suggested package.repository URL: ${repository}`);
    else logWarn("package.repository URL: unknown");
  }
  summaryBox("Scan", { "Packages:": rows.length });
}
function divergence(dir: string, ref: string) {
  const counts = attempt(dir, ["rev-list", "--left-right", "--count", `HEAD...${ref}`, "--"]);
  if (!counts) return unknown;
  const [ahead, behind] = counts.split(/\s+/);
  return `ahead ${ahead}, behind ${behind}`;
}
async function distVersion(url: string, base: string) {
  const temporary = await mkdtemp(join(tmpdir(), "hyperttp-dist-"));
  try {
    const source = repositoryUrl(url, base);
    const refs = git(temporary, ["ls-remote", "--", source, "refs/heads/__dist__"]);
    if (!refs) return "absent";
    const checkout = join(temporary, "checkout");
    git(temporary, [
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      "__dist__",
      "--",
      source,
      checkout,
    ]);
    const pkg = await manifest(checkout);
    return typeof pkg.version === "string" ? pkg.version : unknown;
  } catch {
    return unknown;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function npmVersion(name: string) {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return "absent";
    if (!response.ok) return unknown;
    const pkg = (await response.json()) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : unknown;
  } catch {
    return unknown;
  }
}
export async function status(online = false, base = root) {
  for (const row of await discover(base)) {
    logStep(`${row.short} · ${row.pkg.name} · local ${row.pkg.version ?? unknown}`);
    const own = await ownsGitRoot(row.dir);
    let origin: string | undefined;
    if (!own) logDetail("Git: ordinary directory (no own Git root)");
    else {
      const branch =
        attempt(row.dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ??
        (attempt(row.dir, ["rev-parse", "--short", "HEAD"]) ? "detached" : "unborn");
      const dirty = attempt(row.dir, ["status", "--porcelain", "--untracked-files=normal"]);
      origin = attempt(row.dir, ["remote", "get-url", "origin"]);
      const upstream = attempt(row.dir, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]);
      logDetail(`Git: ${branch} · ${dirty === undefined ? unknown : dirty ? "dirty" : "clean"}`);
      logDetail(
        `Upstream: ${upstream ?? unknown} · ${upstream ? divergence(row.dir, upstream) : unknown}`,
      );
      const originRef =
        branch !== "detached" && branch !== "unborn" ? `refs/remotes/origin/${branch}` : undefined;
      logDetail(
        `Origin: ${origin ?? unknown} · ${originRef ? divergence(row.dir, originRef) : unknown} (local tracking refs)`,
      );
    }
    if (online) {
      const [dist, npm] = await Promise.all([
        origin ? distVersion(origin, row.dir) : Promise.resolve(unknown),
        npmVersion(row.pkg.name),
      ]);
      logDetail(`Remote __dist__: ${dist} · npm: ${npm}`);
    }
  }
}
export async function main(args: string[]) {
  const [command, ...rest] = args;
  if (command === "add" && rest.length >= 1 && rest.length <= 2) return add(rest[0], rest[1]);
  if (command === "scan" && !rest.length) return scan();
  if (command === "status" && (!rest.length || (rest.length === 1 && rest[0] === "--online")))
    return status(rest.length === 1);
  throw new Error("Usage: workspace.ts add <git-url> [directory] | scan | status [--online]");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await cli("workspace", () => main(process.argv.slice(2)));
