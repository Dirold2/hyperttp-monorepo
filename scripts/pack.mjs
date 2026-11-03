import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { packages, root } from "./workspaces.mjs";

const rows = await packages();
const requested = process.argv.slice(2);
if (!requested.length) throw new Error("Specify package names: bun run pack core parser");
for (const name of requested) if (!rows.some(row => row.short === name || row.pkg.name === name)) throw new Error(`Unknown package: ${name}`);
const out = join(root, "artifacts");
await mkdir(out, { recursive: true });
for (const row of rows.filter(row => requested.includes(row.short) || requested.includes(row.pkg.name))) {
  // Bun resolves workspace versions in the packed manifest. Never publish workspace manifests with npm directly.
  const result = spawnSync("bun", ["pm", "pack", "--ignore-scripts", "--destination", out], { cwd: row.dir, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
