import { readFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { cli, logStep, logDetail, runCommand, summaryBox } from "./lib/format.ts";
import { build } from "esbuild";

await cli("build", async () => {
  const cwd = process.cwd();
  const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  logDetail(`Пакет: ${pkg.name} · ${pkg.version}`);
  logStep("Очистка dist и компиляция TypeScript…");
  await rm(join(cwd, "dist"), { recursive: true, force: true });
  runCommand("tsc", [], cwd);
  async function jsFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await jsFiles(path)));
      else if (entry.name.endsWith(".js")) files.push(path);
    }
    return files;
  }
  logStep("Минификация и sourcemaps…");
  const files = await jsFiles(resolve(cwd, "dist"));
  if (files.length)
    await build({
      entryPoints: files,
      outdir: "dist",
      outbase: "dist",
      allowOverwrite: true,
      minify: true,
      keepNames: true,
      sourcemap: true,
      format: "esm",
    });
  if (pkg.exports?.["."]?.require?.endsWith(".cjs")) {
    await build({
      entryPoints: ["dist/index.js"],
      outfile: "dist/index.cjs",
      bundle: true,
      packages: "external",
      platform: "node",
      format: "cjs",
      minify: true,
      keepNames: true,
      sourcemap: true,
    });
  }

  summaryBox("Дистрибутив готов", {
    "Пакет:": pkg.name,
    "Версия:": pkg.version,
    "JS-файлов:": files.length,
  });
});
