import { mkdtemp, rm, readdir, readFile, writeFile, cp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { packages, ordered, root, type Workspace } from "../workspaces.ts";
import { logStep, logDetail } from "./format.ts";

export function capture(command: string, args: string[], cwd = root) {
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_EDITOR: "true",
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes -o ConnectTimeout=15",
    },
  });
  if (r.error || r.status !== 0)
    throw new Error(r.error?.message || r.stderr || r.stdout || `${command}: ${r.status}`);
  return r.stdout.trim();
}
export async function releaseTargets(args: string[]) {
  const rows = await packages();
  const names = args.filter((arg) => arg !== "--dry-run");
  if (!names.length) throw new Error("Укажите пакеты явно: core types (или --all).");
  for (const name of names)
    if (name !== "--all" && !rows.some((row) => row.short === name || row.pkg.name === name))
      throw new Error(`Unknown package: ${name}`);
  return ordered(rows).filter(
    (row) => names.includes("--all") || names.includes(row.short) || names.includes(row.pkg.name),
  );
}
export async function withArchive(
  row: Workspace,
  task: (archive: string, temp: string) => Promise<void>,
  build = true,
) {
  const prepared = process.env.HYPERTTP_RELEASE_ARCHIVE;
  if (prepared) {
    const receipt = JSON.parse(await readFile(prepared + ".json", "utf8"));
    const pkg = JSON.parse(await readFile(join(row.dir, "package.json"), "utf8"));
    await verifyPreparedArchive(prepared, receipt, row.dir, pkg.name, pkg.version);
    const temp = await mkdtemp(join(tmpdir(), "hyperttp-release-output-"));
    try {
      await task(prepared, temp);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    return;
  }
  if (build) {
    logStep(`${row.pkg.name}: сборка с локальными зависимостями…`);
    capture("bun", ["run", "build", row.short]);
  }
  const temp = await mkdtemp(join(tmpdir(), "hyperttp-release-"));
  try {
    capture("bun", ["pm", "pack", "--ignore-scripts", "--destination", temp], row.dir);
    const archives = (await readdir(temp)).filter((name) => name.endsWith(".tgz"));
    if (archives.length !== 1) throw new Error("Ожидался один архив пакета.");
    await task(join(temp, archives[0]!), temp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

// Use Bun's packed manifest: workspace dependencies have already become npm ranges.
export async function prepareDist(archive: string, temp: string) {
  capture("tar", ["-xzf", archive, "-C", temp]);
  const packed = join(temp, "package");
  const out = join(temp, "output");
  await rename(join(packed, "dist"), out);
  const pkg = JSON.parse(await readFile(join(packed, "package.json"), "utf8"));
  const fix = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(/^(?:\.\/)?dist\//, "./");
    if (Array.isArray(value)) return value.map(fix);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fix(item)]));
    return value;
  };
  for (const field of [
    "main",
    "module",
    "types",
    "typings",
    "exports",
    "typesVersions",
    "sideEffects",
    "bin",
  ])
    if (pkg[field] !== undefined) pkg[field] = fix(pkg[field]);
  for (const field of ["scripts", "devDependencies", "files", "publishConfig", "private"])
    delete pkg[field];
  // Git distribution branches are not the npm publication source.
  pkg.private = true;
  await writeFile(join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  for (const name of await readdir(packed)) {
    if (/^(README|LICENSE|LICENCE|NOTICE)(\.|$)/i.test(name))
      await cp(join(packed, name), join(out, name), { recursive: true });
  }
  logDetail(`Манифест dist подготовлен: ${pkg.name}@${pkg.version}`);
  return out;
}

export async function verifyPreparedArchive(
  archive: string,
  receipt: { directory: string; name: string; version: string; sha256: string },
  directory: string,
  name: string,
  version: string,
) {
  if (receipt.directory !== directory || receipt.name !== name || receipt.version !== version)
    throw new Error("Prepared release archive does not match package/version");
  const sha256 = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (sha256 !== receipt.sha256) throw new Error("Prepared release archive checksum mismatch");
}
