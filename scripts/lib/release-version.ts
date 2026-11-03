export type Bump = "patch" | "minor" | "major";
export function bumpVersion(version: string, bump: Bump): string {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error(`Only stable x.y.z versions are supported: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (![major, minor, patch].every(Number.isSafeInteger))
    throw new Error(`Invalid version: ${version}`);
  const result =
    bump === "major"
      ? [major + 1, 0, 0]
      : bump === "minor"
        ? [major, minor + 1, 0]
        : [major, minor, patch + 1];
  if (!result.every(Number.isSafeInteger)) throw new Error("Version overflow");
  return result.join(".");
}

export function parsePackageBump(value: string | undefined): [string, Bump] {
  const match = /^([^=]+)=(patch|minor|major)$/.exec(value ?? "");
  if (!match) throw new Error("--bump-package requires <package>=patch|minor|major");
  return [match[1]!, match[2] as Bump];
}
