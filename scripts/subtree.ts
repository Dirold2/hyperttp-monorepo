import { cli, logStep, logDetail, logWarn, logError, summaryBox } from "./format.ts";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/subtree.ts [--dry-run] [package ...]\nDefaults: all packages, remote branch monorepo. Only committed changes are exported.",
  );
  process.exit(0);
}
await cli("subtree", async () => {
  const dryRun = args.includes("--dry-run");
  const requested = args.filter((arg) => arg !== "--dry-run");
  const rows: { directory: string; name: string }[] = JSON.parse(
    readFileSync(new URL("../migration.json", import.meta.url), "utf8"),
  );
  for (const name of requested) {
    if (!rows.some((row) => row.directory === name || row.name === name)) {
      throw new Error(`Unknown package or option: ${name}`);
    }
  }
  const selected = rows.filter(
    (row) => !requested.length || requested.includes(row.directory) || requested.includes(row.name),
  );
  function git(args: string[], allowed = [0]) {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes -o ConnectTimeout=15",
      },
    });
    if (result.error || !allowed.includes(result.status ?? -1)) {
      throw new Error(
        result.error?.message ||
          result.stderr.trim() ||
          `git ${args.join(" ")} exited ${result.status}`,
      );
    }
    return { output: result.stdout.trim(), status: result.status };
  }

  // Freeze the source snapshot so concurrent commits cannot change the export midway.
  const head = git(["rev-parse", "HEAD"]).output;
  const dirty = git(["status", "--porcelain", "--untracked-files=normal"]).output;
  if (dirty) logWarn("Незакоммиченные изменения не экспортируются: используется HEAD.");
  let failed = 0;
  let skipped = 0;
  let changed = 0;
  logDetail(`Режим: ${dryRun ? "проверка без push" : "push"} · ветка monorepo`);
  for (const row of selected) {
    const remote = row.directory;
    const ref = "refs/heads/monorepo";
    try {
      logStep(`${remote}: сравнение изменений…`);
      git(["remote", "get-url", remote]);
      const local = git(["subtree", "split", `--prefix=packages/${row.directory}`, head]).output;
      const listing = git(["ls-remote", "--exit-code", remote, ref], [0, 2]);
      const advertised = listing.status === 2 ? null : listing.output.split(/\s+/)[0];
      if (advertised === local) {
        logDetail(`[skip] ${remote}: изменений нет`);
        skipped++;
        continue;
      }
      if (advertised) {
        git(["fetch", "--no-tags", remote, ref]);
        const previous = git(["rev-parse", "FETCH_HEAD"]).output;
        if (git(["merge-base", "--is-ancestor", previous, local], [0, 1]).status !== 0) {
          throw new Error("Remote monorepo has divergent history; refusing to overwrite it.");
        }
        // A commit can change history without changing the package's final contents.
        if (
          git(["rev-parse", `${previous}^{tree}`]).output ===
          git(["rev-parse", `${local}^{tree}`]).output
        ) {
          logDetail(`[skip] ${remote}: содержимое не изменилось`);
          skipped++;
          continue;
        }
      }
      if (dryRun) {
        logDetail(
          `[would push] ${remote}: ${local} -> monorepo${advertised ? "" : " (new branch)"}`,
        );
      } else {
        // Normal push rejects concurrent non-fast-forward updates. Never force push.
        git(["push", remote, `${local}:${ref}`]);
        logDetail(`[pushed] ${remote}: monorepo`);
      }
      changed++;
    } catch (error) {
      failed++;
      logError(`[error] ${remote}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  summaryBox("Результат", {
    [dryRun ? "К отправке:" : "Отправлено:"]: changed,
    "Пропущено:": skipped,
    "Ошибок:": failed,
  });
  if (failed) throw new Error(`Не удалось обработать пакетов: ${failed}`);
});
