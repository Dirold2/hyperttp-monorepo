import {
  publishedVersion as registryPublishedVersion,
  waitForPublication,
} from "./lib/npm-registry.ts";
import { listStage, verifyStage } from "./lib/npm-stage.ts";
import { readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cli, logStep, logDetail, logWarn, summaryBox } from "./lib/format.ts";
import { capture, releaseTargets, withArchive } from "./lib/release.ts";
import { root } from "./workspaces.ts";

class PendingPublication extends Error {}

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
  const publishedVersion = (name: string, version: string) =>
    registryPublishedVersion(name, version, registry);
  try {
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
        const markAccepted = async () => {
          await mkdir(attemptDir, { recursive: true });
          await writeFile(
            attemptFile,
            JSON.stringify({
              name: row.pkg.name,
              version,
              status: "processing",
              at: new Date().toISOString(),
            }) + "\n",
          );
        };
        const waitVisible = () =>
          waitForPublication(() => publishedVersion(row.pkg.name, version), 25, 5000);
        const approve = async (): Promise<boolean> => {
          const stage = listStage(row.pkg.name, version, registry);
          if (!stage) return false;
          await verifyStage(stage, archive);
          logDetail(`Staged ${row.pkg.name}@${version}: ${stage.id}; SHA-1 архива совпадает`);
          if (dryRun) return true;
          if (!process.stdin.isTTY)
            throw new Error(
              `Stage ${stage.id} requires interactive approval; run pub in a terminal`,
            );
          logStep("Подтвердите staged-публикацию в npm (2FA/браузер)…");
          const approval = spawnSync(
            "npm",
            ["stage", "approve", stage.id, "--registry", registry],
            {
              cwd: root,
              stdio: "inherit",
              timeout: 10 * 60_000,
            },
          );
          if (approval.error || approval.status !== 0)
            throw new Error(
              approval.error?.message ||
                "npm stage approve failed; resume without bumping the version",
            );
          await markAccepted();
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
            if (attempted) {
              logStep("Ожидание обработки предыдущей попытки в npm (до 2 минут)…");
              if (await waitVisible()) {
                await rm(attemptFile, { force: true });
                published++;
                return;
              }
              throw new PendingPublication(
                `Версия ${row.pkg.name}@${version} ещё не видна. Повторная загрузка заблокирована; подождите и запустите release --resume. Если состояние длительно не меняется, проверьте npm stage list и аккаунт.`,
              );
            }
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
            if (result.status === 0) {
              await markAccepted();
            } else if (!publishedVersion(row.pkg.name, version) && !(await approve())) {
              throw new PendingPublication(
                `npm publish завершился с кодом ${result.status}; результат сохранён. Проверьте показанную диагностику/авторизацию, затем release --resume. Повторный PUT не выполняется.`,
              );
            }
          } else if (result.status !== 0)
            throw new Error(`npm publish --dry-run: ${result.status}`);
        }
        if (!dryRun) {
          logStep("npm принял пакет; ожидаем доступность версии (до 2 минут)…");
          if (!(await waitVisible()))
            throw new PendingPublication(
              `npm ещё обрабатывает ${row.pkg.name}@${version}. Это не отказ публикации. Подождите и используйте release --resume; версия не будет загружена повторно.`,
            );
        }
        if (!dryRun) await rm(attemptFile, { force: true });
        published++;
      });
    }
  } catch (error) {
    if (!(error instanceof PendingPublication)) throw error;
    logWarn(error.message);
    process.exitCode = 2;
    return false;
  }
  summaryBox("npm", {
    "Режим:": dryRun ? "dry-run" : "publish",
    "Пакетов:": published,
    "Пропущено:": skipped,
  });
});
