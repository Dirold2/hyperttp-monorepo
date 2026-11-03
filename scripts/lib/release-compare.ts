import { readdir, readFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { capture, withArchive } from "./release.ts";
import type { Workspace } from "../workspaces.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Compare runtime package contents, not repository tooling or generated sourcemaps. */
export async function packageDigest(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported archive entry: ${path}`);
      if (entry.name.endsWith(".map")) continue;
      const name = relative(directory, path);
      let bytes = await readFile(path);
      if (name === "package.json") {
        const pkg = JSON.parse(bytes.toString());
        for (const field of [
          "version",
          "scripts",
          "devDependencies",
          "packageManager",
          "repository",
          "gitHead",
        ])
          delete pkg[field];
        bytes = Buffer.from(JSON.stringify(canonical(pkg)));
      } else if (/\.(?:js|cjs|mjs|ts)$/.test(name)) {
        bytes = Buffer.from(
          bytes.toString().replace(/^\/\/[#@] sourceMappingURL=.*(?:\r?\n|$)/gm, ""),
        );
      }
      hash.update(JSON.stringify([name, bytes.length]));
      hash.update(bytes);
    }
  }
  await visit(directory);
  return hash.digest("hex");
}

export async function differsFromNpm(row: Workspace, version: string): Promise<boolean> {
  let changed = true;
  await withArchive(row, async (archive, temp) => {
    const local = join(temp, "local"),
      published = join(temp, "published");
    await mkdir(local);
    await mkdir(published);
    capture("tar", ["-xzf", archive, "-C", local]);
    const result = JSON.parse(
      capture("npm", [
        "pack",
        `${row.pkg.name}@${version}`,
        "--json",
        "--ignore-scripts",
        "--registry",
        "https://registry.npmjs.org/",
        "--pack-destination",
        temp,
      ]),
    );
    const packed = Array.isArray(result) ? result[0] : result[row.pkg.name];
    const filename = packed?.filename;
    if (typeof filename !== "string" || filename !== filename.split(/[\\/]/).at(-1))
      throw new Error("Invalid npm archive filename");
    capture("tar", ["-xzf", join(temp, filename), "-C", published]);
    changed =
      (await packageDigest(join(local, "package"))) !==
      (await packageDigest(join(published, "package")));
  });
  return changed;
}
