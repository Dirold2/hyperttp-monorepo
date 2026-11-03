import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { packages, ordered, root } from "./workspaces.ts";
import { capture } from "./release.ts";
import { differsFromNpm } from "./release-compare.ts";
import { bumpVersion, type Bump } from "./release-version.ts";
import { cli, logStep, logDetail, summaryBox, runCommand } from "./format.ts";

type Entry = { short: string; name: string; from: string; to: string };
type Plan = {
  schema: 1;
  head: string;
  entries: Entry[];
  phase: "planned" | "applying" | "versioned" | "done";
  fingerprint?: string;
  dist: string[];
  pub: string[];
  sources?: Record<string, string>;
};

await cli("release", async () => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    logDetail(
      "release <packages | --all> [--bump patch|minor|major] [--dry-run] [--yes]\nrelease --resume [--yes]\nAll workspace checks must pass. No auto-commit or force push.",
    );
    return;
  }
  const dryRun = args.includes("--dry-run"),
    resume = args.includes("--resume"),
    yes = args.includes("--yes");
  let bump: Bump = "patch";
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--dry-run", "--resume", "--yes"].includes(arg)) continue;
    if (arg === "--bump") {
      const value = args[++i];
      if (value !== "patch" && value !== "minor" && value !== "major")
        throw new Error("--bump requires patch, minor or major");
      bump = value;
      continue;
    }
    if (arg.startsWith("--") && arg !== "--all") throw new Error(`Unknown option: ${arg}`);
    names.push(arg);
  }
  if (resume && (names.length || args.includes("--bump")))
    throw new Error("--resume uses the saved plan; do not specify packages or --bump");
  const rows = ordered(await packages());
  const manifest = async (short: string) =>
    JSON.parse(await readFile(join(root, "packages", short, "package.json"), "utf8"));
  const head = capture("git", ["rev-parse", "HEAD"]);
  const stateDir = resolve(root, capture("git", ["rev-parse", "--git-path", "hyperttp-release"]));
  const stateFile = join(stateDir, "plan.json");
  const save = async (plan: Plan) => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(stateFile, JSON.stringify(plan, null, 2) + "\n");
  };
  const fingerprint = (sourceHead = head) =>
    createHash("sha256")
      .update(sourceHead)
      .update(capture("git", ["diff", "--binary", sourceHead, "--", "."]))
      .digest("hex");
  const checks = () => {
    for (const task of ["build", "typecheck", "lint", "format:check", "test"]) {
      logStep(`Все workspaces: ${task}`);
      runCommand("bun", ["run", "scripts/workspaces.ts", task, "--all"], root, 30 * 60_000);
    }
  };
  const sourceHash = async (short: string) => {
    const hash = createHash("sha256");
    const files = capture("git", ["ls-files", "--", `packages/${short}`, "scripts", "package.json"])
      .split("\n")
      .filter(Boolean);
    for (const file of files) {
      hash.update(file);
      if (file === `packages/${short}/package.json`) {
        const pkg = JSON.parse(await readFile(join(root, file), "utf8"));
        delete pkg.version;
        hash.update(JSON.stringify(pkg));
      } else hash.update(await readFile(join(root, file)));
    }
    return hash.digest("hex");
  };
  let saved: Plan | undefined;
  try {
    saved = JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let plan: Plan;
  if (resume) {
    if (!saved || saved.schema !== 1 || saved.phase === "done")
      throw new Error("No pending release plan");
    plan = saved;
    if (plan.phase === "applying")
      throw new Error(
        "Version update was interrupted. Inspect package.json/bun.lock and the saved plan before proceeding; publication has not started.",
      );
    if (plan.head !== head) {
      if (
        plan.phase !== "versioned" ||
        !plan.fingerprint ||
        fingerprint(plan.head) !== plan.fingerprint
      ) {
        throw new Error(
          "HEAD changed and contents differ from the saved release snapshot; refusing to resume",
        );
      }
      logDetail("HEAD изменился, но содержимое совпадает с планом: продолжаем тот же выпуск.");
    }
  } else {
    if (saved && saved.phase !== "done")
      throw new Error("Pending release exists; use --resume. Plan: " + stateFile);
    if (!names.length) throw new Error("Specify packages explicitly or --all");
    for (const name of names)
      if (name !== "--all" && !rows.some((row) => row.short === name || row.pkg.name === name))
        throw new Error(`Unknown package: ${name}`);
    const wanted = new Set(
      rows
        .filter(
          (row) =>
            names.includes("--all") || names.includes(row.short) || names.includes(row.pkg.name),
        )
        .map((row) => row.pkg.name),
    );
    const explicit = new Set(wanted);
    // Include runtime/peer workspace dependencies so new API never relies on an old npm release.
    let added = true;
    while (added) {
      added = false;
      for (const row of rows.filter((row) => wanted.has(row.pkg.name))) {
        for (const name of Object.keys({ ...row.pkg.dependencies, ...row.pkg.peerDependencies })) {
          if (rows.some((dep) => dep.pkg.name === name) && !wanted.has(name)) {
            wanted.add(name);
            added = true;
            logDetail(`Добавлена локальная зависимость: ${name}`);
          }
        }
      }
    }
    const selected = rows.filter((row) => wanted.has(row.pkg.name));
    const entries: Entry[] = [];
    for (const row of selected) {
      if (
        saved?.phase === "done" &&
        saved.sources?.[row.short] === (await sourceHash(row.short)) &&
        !entries.some((other) =>
          Object.hasOwn({ ...row.pkg.dependencies, ...row.pkg.peerDependencies }, other.name),
        )
      ) {
        logDetail(`[skip] ${row.short}: изменений нет после последнего выпуска`);
        continue;
      }
      // npm metadata is the published baseline; network/auth errors are fatal, not 'unpublished'.
      let versions: string[];
      try {
        const value = JSON.parse(
          capture("npm", [
            "view",
            row.pkg.name,
            "versions",
            "--json",
            "--registry",
            "https://registry.npmjs.org/",
          ]),
        );
        versions = Array.isArray(value) ? value : [value];
      } catch (error) {
        if (!/\bE404\b/.test(String(error))) throw error;
        versions = [];
      }
      const pkg = await manifest(row.short);
      const latest = versions
        .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
        .sort((a, b) => {
          const x = a.split(".").map(Number),
            y = b.split(".").map(Number);
          return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
        })
        .at(-1);
      const dependencyChanged = entries.some((entry) =>
        Object.hasOwn({ ...row.pkg.dependencies, ...row.pkg.peerDependencies }, entry.name),
      );
      if (latest && !dependencyChanged) {
        logStep(`${row.pkg.name}: сравнение с npm@${latest}…`);
        if (!(await differsFromNpm(row, latest))) {
          logDetail(`[skip] ${row.short}: содержимое совпадает с опубликованным пакетом`);
          continue;
        }
      }
      const localParts = String(pkg.version).split(".").map(Number);
      const remoteParts = latest?.split(".").map(Number);
      const remoteNewer =
        remoteParts &&
        (remoteParts[0]! - localParts[0]! ||
          remoteParts[1]! - localParts[1]! ||
          remoteParts[2]! - localParts[2]!) > 0;
      const base = remoteNewer ? latest! : pkg.version;
      const to = bumpVersion(base, explicit.has(row.pkg.name) ? bump : "patch");
      if (versions.includes(to))
        throw new Error(`${row.short}@${to} already exists; reconcile local/npm versions`);
      entries.push({ short: row.short, name: row.pkg.name, from: pkg.version, to });
    }
    // Require changed local dependencies to be selected rather than publishing broken ranges.
    for (const entry of entries) {
      const row = rows.find((row) => row.short === entry.short)!;
      for (const name of Object.keys({ ...row.pkg.dependencies, ...row.pkg.peerDependencies })) {
        const dep = rows.find((row) => row.pkg.name === name);
        if (!dep || entries.some((e) => e.name === name)) continue;
        if (capture("git", ["diff", "HEAD", "--", `packages/${dep.short}`]))
          throw new Error(`Include changed dependency ${dep.short} in the release`);
      }
    }
    plan = { schema: 1, head, entries, phase: "planned", dist: [], pub: [] };
  }
  for (const entry of plan.entries) logDetail(`${entry.name}: ${entry.from} → ${entry.to}`);
  if (!plan.entries.length) return;
  if (dryRun) {
    summaryBox("План · без изменений и публикации", {
      "Пакетов:": plan.entries.length,
      "Повышение:": bump,
    });
    return;
  }
  if (capture("git", ["ls-files", "--others", "--exclude-standard"]))
    throw new Error("Commit untracked files before release");
  if (plan.phase === "planned" && capture("git", ["status", "--porcelain"]))
    throw new Error("Commit all changes before release");
  if (plan.phase === "versioned" && plan.fingerprint !== fingerprint(plan.head))
    throw new Error(
      "Working tree changed since versioning; restore the release snapshot before --resume",
    );
  if (!yes) {
    if (!process.stdin.isTTY) throw new Error("Interactive confirmation required (or --yes)");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (
        (await rl.question("Пройти проверки, повысить версии и опубликовать GitHub/npm? [y/N]: "))
          .trim()
          .toLowerCase() !== "y"
      ) {
        logDetail("Отменено: версии не изменены, публикация не запускалась.");
        return false;
      }
    } finally {
      rl.close();
    }
  }
  if (plan.phase === "planned") {
    checks();
    plan.phase = "applying";
    await save(plan);
    // Record every entry first; an interrupted write can be completed safely on resume.
    for (const entry of plan.entries) {
      const path = join(root, "packages", entry.short, "package.json");
      const pkg = await manifest(entry.short);
      pkg.version = entry.to;
      await writeFile(path, JSON.stringify(pkg, null, 2) + "\n");
    }
    runCommand("bun", ["install", "--lockfile-only", "--ignore-scripts"], root);
    plan.phase = "versioned";
    plan.fingerprint = fingerprint(plan.head);
    await save(plan);
  }
  checks();
  for (const entry of plan.entries) {
    if ((await manifest(entry.short)).version !== entry.to)
      throw new Error("Release manifest version mismatch");
    for (const stage of ["dist", "pub"] as const) {
      if (plan[stage].includes(entry.short)) continue;
      logStep(`${entry.name}: ${stage}`);
      runCommand(
        "bun",
        ["run", `scripts/${stage}.ts`, entry.short],
        root,
        30 * 60_000,
        stage === "pub",
      );
      plan[stage].push(entry.short);
      await save(plan);
    }
  }
  plan.sources = Object.fromEntries(
    await Promise.all(
      plan.entries.map(async (entry) => [entry.short, await sourceHash(entry.short)]),
    ),
  );
  plan.phase = "done";
  await save(plan);
  summaryBox("Выпуск завершён", { "Пакетов:": plan.entries.length, "План:": stateFile });
  logDetail(
    "Версии и bun.lock остаются в рабочем дереве: проверьте и закоммитьте их. Автокоммитов нет.",
  );
});
