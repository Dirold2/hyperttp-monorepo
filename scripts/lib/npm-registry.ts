import { spawnSync } from "node:child_process";

/** npm versions differ: an exact view can return a string, array or keyed object. */
export function containsVersion(value: unknown, name: string, version: string): boolean {
  if (typeof value === "string") return value === version;
  if (Array.isArray(value)) return value.some((item) => containsVersion(item, name, version));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.version === version) return record.name === undefined || record.name === name;
    return containsVersion(record[`${name}@${version}`] ?? record[name], name, version);
  }
  return false;
}
export function publishedVersion(name: string, version: string, registry: string): boolean {
  const result = spawnSync(
    "npm",
    ["view", `${name}@${version}`, "version", "--json", "--prefer-online", "--registry", registry],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status === 0) {
    const data: unknown = JSON.parse(result.stdout);
    if (!containsVersion(data, name, version))
      throw new Error(`Unexpected npm view response for ${name}@${version}: ${result.stdout}`);
    return true;
  }
  let code: string | undefined;
  try {
    code = JSON.parse(result.stdout || result.stderr).error?.code;
  } catch {
    /* Report original error. */
  }
  if (code === "E404") return false;
  throw new Error(result.stderr || result.stdout || "npm view failed");
}
export async function waitForPublication(
  check: () => boolean,
  attempts = 6,
  delayMs = 2000,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (check()) return true;
    if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

/** A successful publish/approval receipt is sufficient; registry visibility is eventual. */
export function acceptedPublication(value: unknown, name: string, version: string): boolean {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return receipt.name === name && receipt.version === version && receipt.status === "processing";
}
