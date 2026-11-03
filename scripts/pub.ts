import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  if (!dryRun) capture("npm", ["whoami", "--registry", registry]);
  for (const row of targets) {
    const version = JSON.parse(await readFile(join(row.dir, "package.json"), "utf8"))
      .version as string;
    if (!version) throw new Error(`${row.short}: отсутствует version`);
    const view = spawnSync(
      "npm",
      ["view", `${row.pkg.name}@${version}`, "version", "--json", "--registry", registry],
      { cwd: root, encoding: "utf8", timeout: 120_000 },
    );
    if (view.error) throw view.error;
    if (view.status === 0 && JSON.parse(view.stdout) === version) {
      skipped++;
      logDetail(`[skip] ${row.pkg.name}@${version}: уже опубликован`);
      continue;
    }
    if (view.status !== 0) {
      let code: string | undefined;
      try {
        code = JSON.parse(view.stdout || view.stderr).error?.code;
      } catch {
        /* Preserve unrecognized network/auth diagnostics below. */
      }
      if (code !== "E404")
        throw new Error(view.stderr || view.stdout || "Не удалось проверить npm version");
    }
    await withArchive(row, async (archive) => {
      logStep(`${row.pkg.name}@${version}: ${dryRun ? "проверка публикации" : "публикация"}…`);
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
        { cwd: root, stdio: "inherit", timeout: 180_000 },
      );
      if (result.error || result.status !== 0)
        throw new Error(result.error?.message || `npm publish: ${result.status}`);
      published++;
    });
  }
  summaryBox("npm", {
    "Режим:": dryRun ? "dry-run" : "publish",
    "Пакетов:": published,
    "Пропущено:": skipped,
  });
});
