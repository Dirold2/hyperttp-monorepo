import { readFile, readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { cli, logStep, runCommand, summaryBox } from "./lib/format.ts";

export const root = fileURLToPath(new URL("../", import.meta.url));
export interface Workspace {
  dir: string;
  short: string;
  pkg: {
    name: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}
export async function packages(): Promise<Workspace[]> {
  const rows: Workspace[] = [];
  for (const entry of await readdir(join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, "packages", entry.name);
    try {
      await access(join(dir, "package.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    rows.push({ dir, short: entry.name, pkg });
  }
  const names = new Set<string>();
  for (const row of rows) {
    if (names.has(row.pkg.name)) throw new Error(`Duplicate workspace name: ${row.pkg.name}`);
    names.add(row.pkg.name);
  }
  return rows;
}
export function ordered(rows: Workspace[]): Workspace[] {
  const byName = new Map(rows.map((row) => [row.pkg.name, row]));
  const done = new Set();
  const visiting = new Set();
  const result: Workspace[] = [];
  function visit(row: Workspace) {
    if (done.has(row.pkg.name)) return;
    if (visiting.has(row.pkg.name)) throw new Error(`Dependency cycle: ${row.pkg.name}`);
    visiting.add(row.pkg.name);
    for (const name of Object.keys({
      ...row.pkg.dependencies,
      ...row.pkg.devDependencies,
      ...row.pkg.peerDependencies,
    })) {
      if (byName.has(name)) visit(byName.get(name)!);
    }
    visiting.delete(row.pkg.name);
    done.add(row.pkg.name);
    result.push(row);
  }
  rows.forEach(visit);
  return result;
}
export const stable = new Set([
  "types",
  "core",
  "hyperttp",
  "auth",
  "cache",
  "crypto",
  "inflight",
  "interceptors",
  "metrics",
  "parser",
  "queue",
  "ratelimit",
  "retry",
  "serializer",
]);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await cli("workspaces", async () => {
    const [task, ...args] = process.argv.slice(2);
    if (!task) throw new Error("Usage: workspaces.ts <script> [--all | package-name]");
    const rows = await packages();
    const all = args.includes("--all");
    const selected = args.filter((arg) => arg !== "--all");
    for (const arg of selected)
      if (!rows.some((row) => row.short === arg || row.pkg.name === arg))
        throw new Error(`Unknown package: ${arg}`);
    const targets = rows.filter(
      (row) =>
        all ||
        (selected.length
          ? selected.includes(row.short) || selected.includes(row.pkg.name)
          : stable.has(row.short)),
    );
    const execution = ordered(task === "build" ? rows : targets);
    const needed = new Set(ordered(targets).map((row) => row.pkg.name));
    // Build selected packages with their transitive local dependencies.
    if (task === "build") {
      function include(row: Workspace) {
        if (needed.has(row.pkg.name + ":deps")) return;
        needed.add(row.pkg.name + ":deps");
        needed.add(row.pkg.name);
        for (const name of Object.keys({
          ...row.pkg.dependencies,
          ...row.pkg.devDependencies,
          ...row.pkg.peerDependencies,
        })) {
          const dependency = rows.find((item) => item.pkg.name === name);
          if (dependency) include(dependency);
        }
      }
      targets.forEach(include);
    }
    let completed = 0;
    for (const row of execution) {
      if (!needed.has(row.pkg.name) || !row.pkg.scripts?.[task]) continue;
      logStep(`${row.pkg.name}: ${task}`);
      runCommand("bun", ["run", task], row.dir, 30 * 60_000);
      completed++;
    }
    summaryBox("Результат", { "Команда:": task, "Пакетов:": completed });
  });
}
