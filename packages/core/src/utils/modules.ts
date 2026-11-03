export function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND") return true;

  const message = err instanceof Error ? err.message : String(e.message ?? "");
  return (
    message.includes("Cannot find module") ||
    message.includes("Failed to resolve") ||
    message.includes("Failed to load")
  );
}

export async function dynamicImport(pkg: string): Promise<Record<string, unknown>> {
  /* @vite-ignore */
  return import(/* webpackIgnore: true */ pkg);
}
