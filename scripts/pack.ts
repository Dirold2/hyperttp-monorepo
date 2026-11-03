import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cli, logStep, runCommand, summaryBox } from "./format.ts";
import { packages, root } from "./workspaces.ts";

await cli("pack", async () => {
  const rows = await packages();
  const requested = process.argv.slice(2);
  if (!requested.length) throw new Error("Specify package names: bun run pack core parser");
  for (const name of requested)
    if (!rows.some((row) => row.short === name || row.pkg.name === name))
      throw new Error(`Unknown package: ${name}`);
  const out = join(root, "artifacts");
  await mkdir(out, { recursive: true });
  const selected = rows.filter(
    (row) => requested.includes(row.short) || requested.includes(row.pkg.name),
  );
  for (const row of selected) {
    // Bun resolves workspace versions in the packed manifest. Never publish workspace manifests with npm directly.
    logStep(`${row.pkg.name}: упаковка .tgz`);
    runCommand("bun", ["pm", "pack", "--ignore-scripts", "--destination", out], row.dir);
  }
  summaryBox("Архивы готовы · без npm publish", { "Пакетов:": selected.length, "Каталог:": out });
});
