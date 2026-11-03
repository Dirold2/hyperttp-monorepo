import {
  assertReleaseRepository,
  assertReleaseRepositories,
  sourceSnapshot,
} from "./lib/release-source.ts";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { packages, ordered, root } from "./workspaces.ts";
import { capture } from "./lib/release.ts";
import { differsFromNpm } from "./lib/release-compare.ts";
import { bumpVersion, parsePackageBump, type Bump } from "./lib/release-version.ts";
import { cli, logStep, logDetail, summaryBox, runCommand } from "./lib/format.ts";

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
  snapshots?: Record<string, string>;
};

await cli("release", async () => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    logDetail(
      "release <packages | --all> [--bump patch|minor|major] [--bump-package voice=minor] [--dry-run] [--yes]\nrelease --resume [--yes]\nSelected packages and dependencies are checked. Source commits are created in isolation; no force push.",
    );
    return;
  }
  const dryRun = args.includes("--dry-run"),
    resume = args.includes("--resume"),
    yes = args.includes("--yes");
  let bump: Bump = "patch";
  const names: string[] = [];
  const packageBumps = new Map<string, Bump>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--dry-run", "--resume", "--yes"].includes(arg)) continue;
    if (arg === "--bump-package") {
      const [name, value] = parsePackageBump(args[++i]);
      if (packageBumps.has(name)) throw new Error(`Duplicate package bump: ${name}`);
      packageBumps.set(name, value);
      continue;
    }
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
  if (resume && (names.length || args.includes("--bump") || packageBumps.size))
    throw new Error("--resume uses the saved plan; do not specify packages or bump options");
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
  const packageSnapshot = () =>
    rows.map((row) => {
      const own = capture("git", ["rev-parse", "--show-toplevel"], row.dir) === row.dir;
      return own
        ? [
            row.short,
            capture("git", ["rev-parse", "HEAD"], row.dir),
            capture("git", ["diff", "--binary", "HEAD"], row.dir),
            capture("git", ["ls-files", "--others", "--exclude-standard"], row.dir),
          ]
        : [row.short];
    });
  const fingerprint = (sourceHead = head) =>
    createHash("sha256")
      .update(sourceHead)
      .update(capture("git", ["diff", "--binary", sourceHead, "--", "."]))
      .update(JSON.stringify(packageSnapshot()))
      .digest("hex");
  const checks = (tasks = ["build", "typecheck", "lint", "format:check", "test"]) => {
    const selected = rows.filter((row) => checkedNames.has(row.pkg.name)).map((row) => row.short);
    for (const task of tasks) {
      logStep(`Выбранные пакеты и зависимости: ${task}`);
      runCommand("bun", ["run", "scripts/workspaces.ts", task, ...selected], root, 30 * 60_000);
    }
  };
  const sourceHash = async (short: string) => {
    const row = rows.find((row) => row.short === short)!;
    return sourceSnapshot(row.dir, true);
  };
  const releaseSnapshots = async (ignoreVersion = false) =>
    Object.fromEntries(
      await Promise.all(
        rows
          .filter((row) => checkedNames.has(row.pkg.name))
          .map(async (row) => [
            row.short,
            createHash("sha256")
              .update(capture("git", ["rev-parse", "HEAD"], row.dir))
              .update(capture("git", ["remote", "get-url", "origin"], row.dir))
              .update(await sourceSnapshot(row.dir, ignoreVersion))
              .digest("hex"),
          ]),
      ),
    );
  const assertSnapshots = async (expected: Record<string, string>) => {
    for (const row of rows.filter((row) => checkedNames.has(row.pkg.name)))
      await assertReleaseRepository(row.dir);
    const current = await releaseSnapshots();
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error(
        "Release sources changed since validation; refusing to publish a different snapshot",
      );
  };
  const checkedNames = new Set<string>();
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
    if (!plan.snapshots && plan.head !== head) {
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
    const overrides = new Map<string, Bump>();
    for (const [name, value] of packageBumps) {
      const row = rows.find((row) => row.short === name || row.pkg.name === name);
      if (!row) throw new Error(`Unknown package in --bump-package: ${name}`);
      if (!wanted.has(row.pkg.name))
        throw new Error(`Package bump requires selecting ${name} (or --all)`);
      if (overrides.has(row.pkg.name)) throw new Error(`Duplicate package bump: ${name}`);
      overrides.set(row.pkg.name, value);
    }
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
    await assertReleaseRepositories(selected);
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
      // Compare the local release line, never an unrelated higher npm major.
      const publishedBase = versions.includes(pkg.version) ? pkg.version : undefined;
      const dependencyChanged = entries.some((entry) =>
        Object.hasOwn({ ...row.pkg.dependencies, ...row.pkg.peerDependencies }, entry.name),
      );
      if (publishedBase && !dependencyChanged) {
        logStep(`${row.pkg.name}: сравнение с npm@${publishedBase}…`);
        if (!(await differsFromNpm(row, publishedBase))) {
          logDetail(`[skip] ${row.short}: содержимое совпадает с опубликованным пакетом`);
          continue;
        }
      }
      const to = bumpVersion(
        pkg.version,
        overrides.get(row.pkg.name) ?? (explicit.has(row.pkg.name) ? bump : "patch"),
      );
      if (versions.includes(to))
        throw new Error(`${row.short}@${to} already exists; reconcile local/npm versions`);
      entries.push({ short: row.short, name: row.pkg.name, from: pkg.version, to });
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
  for (const entry of plan.entries) checkedNames.add(entry.name);
  // Include build/typecheck/test dependencies, even when they need no npm release.
  for (const row of [...rows].reverse()) {
    if (!checkedNames.has(row.pkg.name)) continue;
    for (const name of Object.keys({
      ...row.pkg.dependencies,
      ...row.pkg.devDependencies,
      ...row.pkg.peerDependencies,
    }))
      if (rows.some((dep) => dep.pkg.name === name)) checkedNames.add(name);
  }
  for (const row of rows.filter((row) => checkedNames.has(row.pkg.name)))
    await assertReleaseRepository(row.dir);
  if (plan.phase === "versioned") {
    if (!plan.snapshots)
      throw new Error(
        "Legacy release plan: finish or archive it before starting a snapshot-based release",
      );
    await assertSnapshots(plan.snapshots);
  }
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
    const sourceBeforeVersioning = await releaseSnapshots(true);
    const beforeChecks = await releaseSnapshots();
    checks();
    await assertSnapshots(beforeChecks);
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
    if (JSON.stringify(await releaseSnapshots(true)) !== JSON.stringify(sourceBeforeVersioning))
      throw new Error(
        "Sources changed while updating versions; inspect the applying release plan before continuing",
      );
    plan.phase = "versioned";
    plan.snapshots = await releaseSnapshots();
    await save(plan);
  }
  checks(plan.phase === "versioned" ? ["build", "typecheck"] : undefined);
  await assertSnapshots(plan.snapshots!);
  for (const entry of plan.entries) {
    if ((await manifest(entry.short)).version !== entry.to)
      throw new Error("Release manifest version mismatch");
    for (const stage of ["dist", "pub"] as const) {
      if (plan[stage].includes(entry.short)) continue;
      await assertSnapshots(plan.snapshots!);
      logStep(`${entry.name}: ${stage}`);
      if (stage === "pub") {
        const result = spawnSync("bun", ["run", "scripts/pub.ts", entry.short], {
          cwd: root,
          stdio: "inherit",
          timeout: 30 * 60_000,
        });
        if (result.status === 2) {
          logDetail(
            "Выпуск ожидает обработки npm. План сохранён; позже выполните release --resume.",
          );
          process.exitCode = 2;
          return false;
        }
        if (result.error || result.status !== 0)
          throw new Error(result.error?.message || `pub: exit ${result.status}`);
      } else runCommand("bun", ["run", "scripts/dist.ts", entry.short], root, 30 * 60_000);
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
    "Исходные релизные коммиты отправлены в пакетные main. Локальные workspace-манифесты и ветки сохранены; версии и bun.lock обновлены локально.",
  );
});
