import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { packages, root, stable } from "./workspaces.ts";

const actions = [
  { label: "GitHub __dist__ (dry-run)", script: "dist.ts", args: ["--dry-run"] },
  { label: "GitHub __dist__ (push)", script: "dist.ts", args: [], confirm: true },
  { label: "npm pub (dry-run)", script: "pub.ts", args: ["--dry-run"] },
  { label: "npm pub (publish)", script: "pub.ts", args: [], confirm: true },
  { label: "Сборка dist", script: "workspaces.ts", args: ["build"] },
  { label: "Проверка типов", script: "workspaces.ts", args: ["typecheck"] },
  { label: "Тесты", script: "workspaces.ts", args: ["test"] },
  { label: "Lint", script: "workspaces.ts", args: ["lint"] },
  { label: "Проверка форматирования", script: "workspaces.ts", args: ["format:check"] },
  {
    label: "Обновление зависимостей (включая major)",
    script: "update.ts",
    args: [],
    confirm: true,
  },
  { label: "Упаковка .tgz в artifacts (без npm publish)", script: "pack.ts", args: [] },
  { label: "Проверка subtree (без push)", script: "subtree.ts", args: ["--dry-run"] },
  { label: "Push subtree в ветки monorepo", script: "subtree.ts", args: [], confirm: true },
];

if (process.argv.includes("--help")) {
  console.log(
    "Hyperttp TUI: node scripts/tui.ts | bun scripts/tui.ts | deno run -A scripts/tui.ts\nВыбор команды и пакетов по номерам. Выход: 0 или Ctrl+C.",
  );
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    "TUI требует интерактивного терминала. Для автоматизации используйте отдельные scripts/*.ts.",
  );
  process.exitCode = 1;
} else {
  const rows = (await packages()).sort((a, b) => a.short.localeCompare(b.short));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const abort = new AbortController();
  rl.on("SIGINT", () => abort.abort());
  const ask = (text: string) => rl.question(text, { signal: abort.signal });
  try {
    while (!abort.signal.aborted) {
      console.log("\n╭─ Hyperttp · monorepo ─╮");
      actions.forEach((action, index) => console.log(` ${index + 1}. ${action.label}`));
      console.log(" 0. Выход");
      const input = (await ask("\nКоманда: ")).trim();
      if (input === "0") break;
      if (!/^[1-9]\d*$/.test(input) || !actions[Number(input) - 1]) {
        console.log("Выберите номер команды.");
        continue;
      }
      const action = actions[Number(input) - 1]!;
      console.log("\nПакеты:");
      rows.forEach((row, index) => console.log(` ${String(index + 1).padStart(2)}. ${row.short}`));
      console.log(" all — все пакеты; stable — основной CI-набор; 0 — назад");
      const selection = (await ask("Пакеты (номера через пробел или запятую): ")).trim();
      if (selection === "0") continue;
      let names: string[];
      if (selection === "all") names = rows.map((row) => row.short);
      else if (selection === "stable")
        names = rows.filter((row) => stable.has(row.short)).map((row) => row.short);
      else {
        const tokens = selection.split(/[\s,]+/);
        if (tokens.some((token) => !/^[1-9]\d*$/.test(token) || !rows[Number(token) - 1])) {
          console.log("Некорректный выбор пакетов.");
          continue;
        }
        names = [...new Set(tokens.map((token) => rows[Number(token) - 1]!.short))];
      }
      // The update script includes the root manifest only when no packages are specified.
      const targets = action.script === "update.ts" && selection === "all" ? [] : names;
      const args = [...action.args, ...targets];
      console.log(
        `\n${action.label}: ${names.join(", ")}${action.script === "update.ts" && selection === "all" ? " + корень" : ""}`,
      );
      if (action.confirm && (await ask("Продолжить? [y/N]: ")).trim().toLowerCase() !== "y")
        continue;
      const deno = "deno" in process.versions;
      const runtimeArgs = deno
        ? [
            "run",
            "--no-config",
            "--no-lock",
            "--node-modules-dir=manual",
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "--allow-run",
          ]
        : [];
      const result = spawnSync(
        process.execPath,
        [...runtimeArgs, join(root, "scripts", action.script), ...args],
        {
          cwd: root,
          stdio: "inherit",
          timeout: 30 * 60_000,
        },
      );
      if (result.error) console.error(result.error.message);
      console.log(
        result.status === 0
          ? "\n✓ Готово"
          : `\n✗ Команда завершилась с ошибкой (${result.status ?? result.signal ?? "unknown"})`,
      );
    }
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    rl.close();
  }
}
