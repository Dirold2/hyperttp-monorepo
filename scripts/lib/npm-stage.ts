import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { capture } from "./release.ts";

export interface NpmStage {
  id: string;
  packageName: string;
  version: string;
  shasum: string;
}
export function selectStage(value: unknown, name: string, version: string): NpmStage | undefined {
  if (!Array.isArray(value)) throw new Error("Invalid npm stage list response");
  const matches = value.filter((item) => item?.packageName === name && item?.version === version);
  if (matches.length > 1)
    throw new Error(`Multiple stages for ${name}@${version}; inspect npm stage list`);
  const stage = matches[0];
  if (!stage) return undefined;
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(stage.id) ||
    !/^[0-9a-f]{40}$/i.test(stage.shasum)
  )
    throw new Error("Invalid npm stage identity or shasum");
  return stage;
}
export function listStage(name: string, version: string, registry: string): NpmStage | undefined {
  return selectStage(
    JSON.parse(capture("npm", ["stage", "list", name, "--json", "--registry", registry])),
    name,
    version,
  );
}
export async function verifyStage(stage: NpmStage, archive: string) {
  const hash = createHash("sha1")
    .update(await readFile(archive))
    .digest("hex");
  if (hash !== stage.shasum.toLowerCase())
    throw new Error(
      `Staged tarball differs from local archive (${stage.id}). Inspect npm stage view/download; refusing automatic approval or replacement.`,
    );
}
