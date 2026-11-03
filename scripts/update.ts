import { cli, logStep, logWarn, runCommand, summaryBox } from "./lib/format.ts";
import { packages, root } from "./workspaces.ts";

await cli("update", async () => {
  logWarn("Обновление до latest, включая major. Lifecycle scripts отключены.");
  const rows = await packages();
  const requested = process.argv.slice(2);
  for (const name of requested) {
    if (!rows.some((row) => row.short === name || row.pkg.name === name)) {
      throw new Error(`Unknown package: ${name}`);
    }
  }
  const selected = rows.filter(row => requested.includes(row.short) || requested.includes(row.pkg.name));
  // Bun 1.4.4's filter mode saves every matching workspace manifest, unlike recursive mode.
  // One invocation also avoids repeated resolution/install and concurrent lockfile writes.
  const filters = requested.length ? selected.map(row => row.pkg.name) : ["*"];
  logStep(requested.length ? `Обновление: ${selected.map(row => row.short).join(", ")}` : "Обновление корня и всех workspace-пакетов…");
  runCommand("bun", ["update", ...filters.flatMap(name => ["--filter", name]), "--latest", "--save", "--ignore-scripts"], root);
  summaryBox("Результат", {
    "Обработано:": requested.length ? selected.length : rows.length + 1,
    "Запусков Bun:": 1,
    "Lockfile:": "bun.lock",
  });
});
