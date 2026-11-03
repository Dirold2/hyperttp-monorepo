import { createHash } from "node:crypto";
import { lstat, readFile, readlink, access, cp, rm, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { capture } from "./release.ts";

export async function assertReleaseRepository(directory: string) {
  if (resolve(capture("git", ["rev-parse", "--show-toplevel"], directory)) !== resolve(directory))
    throw new Error(`Release requires an independent package repository: ${directory}`);
  if (capture("git", ["branch", "--show-current"], directory) !== "main")
    throw new Error(`Release requires branch main: ${directory}`);
  if (capture("git", ["ls-files", "-u"], directory))
    throw new Error(`Resolve Git conflicts before release: ${directory}`);
  for (const name of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "BISECT_LOG",
  ]) {
    const path = resolve(directory, capture("git", ["rev-parse", "--git-path", name], directory));
    try {
      await access(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`Finish Git operation ${name} before release: ${directory}`);
  }
}

/** Report all topology blockers before costly registry queries or builds. */
export async function assertReleaseRepositories(rows: readonly { short: string; dir: string }[]) {
  const errors: string[] = [];
  for (const row of rows) {
    try {
      await assertReleaseRepository(row.dir);
      capture("git", ["remote", "get-url", "origin"], row.dir);
    } catch (error) {
      errors.push(`${row.short}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length)
    throw new Error(
      "Пакеты не готовы к Git-релизу:\n" +
        errors.map((error) => `  • ${error}`).join("\n") +
        "\nПодключите отдельные репозитории пакетов с origin перед выпуском. Обычная папка не может отправлять пакетные main и теги; --all не пропускает её молча.",
    );
}

/** Include tracked and non-ignored new files, but never Git metadata or ignored build output. */
export function sourceFiles(directory: string): string[] {
  return [
    ...new Set(
      capture("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], directory)
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
}

export async function sourceSnapshot(directory: string, ignoreVersion = false): Promise<string> {
  const hash = createHash("sha256");
  for (const file of sourceFiles(directory)) {
    const path = join(directory, file);
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update(JSON.stringify([file, "deleted"]));
      continue;
    }
    if (!stat.isFile() && !stat.isSymbolicLink())
      throw new Error(`Unsupported source entry: ${path}`);
    let data = stat.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
    if (ignoreVersion && file === "package.json") {
      const pkg = JSON.parse(data.toString());
      delete pkg.version;
      data = Buffer.from(JSON.stringify(pkg));
    }
    hash.update(
      JSON.stringify([file, stat.isSymbolicLink() ? "link" : stat.mode & 0o111, data.length]),
    );
    hash.update(data);
  }
  return hash.digest("hex");
}

export async function copySource(directory: string, destination: string) {
  for (const file of sourceFiles(destination)) await rm(join(destination, file), { force: true });
  for (const file of sourceFiles(directory)) {
    const from = join(directory, file);
    try {
      await lstat(from);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const to = join(destination, file);
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { verbatimSymlinks: true });
  }
}
