import { listStage, verifyStage } from "./npm-stage.ts";
import { readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cli, logStep, logDetail, summaryBox } from "./format.ts";
import { capture, releaseTargets, withArchive } from "./release.ts";
import { root } from "./workspaces.ts";

await cli("pub → npm", async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const targets = await releaseTargets(args);
  let published = 0,
    skipped = 0;
  // Explicit registry prevents accidental publication to a configured private registry.
  const registry = "https://registry.npmjs.org/";
  if (!dryRun) {
    const identity = spawnSync("npm", ["whoami", "--registry", registry], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (identity.error) throw identity.error;
    if (identity.status !== 0) {
      if (!/\b(E401|ENEEDAUTH)\b/.test(identity.stderr || identity.stdout)) {
        throw new Error(identity.stderr || identity.stdout || "npm whoami failed");
      }
      if (!process.stdin.isTTY)
        throw new Error("Требуется npm login. Запустите pub в интерактивном терминале.");
      logStep("Авторизация npm в браузере…");
      const login = spawnSync("npm", ["login", "--auth-type=web", "--registry", registry], {
        cwd: root,
        stdio: "inherit",
        timeout: 10 * 60_000,
      });
      if (login.error || login.status !== 0)
        throw new Error(login.error?.message || "npm login failed");
      capture("npm", ["whoami", "--registry", registry]);
    }
  }
  // Stage support is required: silently falling back to repeated publish is unsafe.
  capture("npm", ["stage", "--help"]);
  const publishedVersion = (name: string, version: string): boolean => {
    const result = spawnSync(
      "npm",
      [
        "view",
        `${name}@${version}`,
        "version",
        "--json",
        "--prefer-online",
        "--registry",
        registry,
      ],
      { cwd: root, encoding: "utf8", timeout: 120_000 },
    );
    if (result.error) throw result.error;
    if (result.status === 0) return JSON.parse(result.stdout) === version;
    let code: string | undefined;
    try {
      code = JSON.parse(result.stdout || result.stderr).error?.code;
    } catch {
      /* Report original diagnostics. */
    }
    if (code === "E404") return false;
    throw new Error(result.stderr || result.stdout || "npm view failed");
  };
  for (const row of targets) {
    const version = JSON.parse(await readFile(join(row.dir, "package.json"), "utf8"))
      .version as string;
    if (!version) throw new Error(`${row.short}: отсутствует version`);
    const attemptDir = resolve(
      root,
      capture("git", ["rev-parse", "--git-path", "hyperttp-release/npm-attempts"]),
    );
    const attemptFile = join(attemptDir, `${row.short}-${version}.json`);
    if (publishedVersion(row.pkg.name, version)) {
      await rm(attemptFile, { force: true });
      skipped++;
      logDetail(`[skip] ${row.pkg.name}@${version}: уже опубликован`);
      continue;
    }
    await withArchive(row, async (archive) => {
      const approve = async (): Promise<boolean> => {
        const stage = listStage(row.pkg.name, version, registry);
        if (!stage) return false;
        await verifyStage(stage, archive);
        logDetail(`Staged ${row.pkg.name}@${version}: ${stage.id}; SHA-1 архива совпадает`);
        if (dryRun) return true;
        if (!process.stdin.isTTY)
          throw new Error(`Stage ${stage.id} requires interactive approval; run pub in a terminal`);
        logStep("Подтвердите staged-публикацию в npm (2FA/браузер)…");
        const approval = spawnSync("npm", ["stage", "approve", stage.id, "--registry", registry], {
          cwd: root,
          stdio: "inherit",
          timeout: 10 * 60_000,
        });
        if (approval.error || approval.status !== 0)
          throw new Error(
            approval.error?.message ||
              "npm stage approve failed; resume without bumping the version",
          );
        return true;
      };
      if (!(await approve())) {
        if (!dryRun) {
          let attempted = false;
          try {
            await access(attemptFile);
            attempted = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (attempted)
            throw new Error(
              `Previous publish attempt is unresolved: ${attemptFile}. No visible version or accessible stage; inspect npm before retrying. Do not delete this marker until registry state is resolved.`,
            );
          await mkdir(attemptDir, { recursive: true });
          await writeFile(
            attemptFile,
            JSON.stringify({ name: row.pkg.name, version, at: new Date().toISOString() }) + "\n",
            { flag: "wx" },
          );
        }
        logStep(`${row.pkg.name}@${version}: ${dryRun ? "dry-run" : "публикация"}…`);
        const result = spawnSync(
          "npm",
          [
            "publish",
            archive,
            "--access",
            "public",
            "--ignore-scripts",
            "--registry",
            registry,
            ...(dryRun ? ["--dry-run"] : []),
          ],
          { cwd: root, stdio: "inherit", timeout: 10 * 60_000 },
        );
        if (result.error) throw result.error;
        if (!dryRun) {
          // An interrupted proof-of-presence flow may already have staged the version.
          if (!publishedVersion(row.pkg.name, version) && !(await approve())) {
            throw new Error(
              "npm publication is not visible and no accessible stage exists. Do not retry PUT blindly or bump the version: inspect npm account/stages or contact npm support.",
            );
          }
        } else if (result.status !== 0) throw new Error(`npm publish --dry-run: ${result.status}`);
      }
      if (!dryRun && !publishedVersion(row.pkg.name, version)) {
        throw new Error(
          "Approval completed but version is not yet visible in npm. Wait, then --resume; stage is not marked as published.",
        );
      }
      if (!dryRun) await rm(attemptFile, { force: true });
      published++;
    });
  }
  summaryBox("npm", {
    "Режим:": dryRun ? "dry-run" : "publish",
    "Пакетов:": published,
    "Пропущено:": skipped,
  });
});
