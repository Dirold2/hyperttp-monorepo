import { spawnSync } from "node:child_process";

const color =
  Boolean(process.stdout.isTTY) &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";
const paint = (code: number, text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
export const bold = (text: string) => paint(1, text);
export const cyan = (text: string) => paint(36, text);
export const green = (text: string) => paint(32, text);
export const fmtDuration = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
export const logHeader = (command: string) =>
  console.log(
    `\n${cyan("╭─ Hyperttp")} · ${bold(command)}\n${cyan("╰────────────────────────────────────────")}\n`,
  );
export const logStep = (text: string) => console.log(`${cyan("›")} ${bold(text)}`);
export const logDetail = (text: string) => console.log(`  ${text}`);
export const logWarn = (text: string) => console.warn(`  ${paint(33, "!")} ${text}`);
export const logError = (text: string) => console.error(`\n${paint(31, "✗")} ${text}`);
export const logSuccess = (text: string, ms?: number) =>
  console.log(`\n${green("✓")} ${text}${ms === undefined ? "" : ` · ${fmtDuration(ms)}`}`);
export function summaryBox(title: string, rows: Record<string, string | number>) {
  const width = Math.max(...Object.keys(rows).map((key) => key.length), 0);
  console.log(`\n${cyan(`╭─ ${title}`)}`);
  for (const [key, value] of Object.entries(rows)) console.log(`│ ${key.padEnd(width)}  ${value}`);
  console.log(cyan("╰────────────────────────────────────────"));
}

// Keep successful commands quiet; preserve their full diagnostic output on failure.
export function runCommand(command: string, args: string[], cwd: string, timeout = 120_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(
      result.error?.message ||
        `${command} ${args.join(" ")}: exit ${result.status ?? result.signal}`,
    );
  }
}
export async function cli(command: string, task: () => Promise<void>) {
  const start = Date.now();
  logHeader(command);
  try {
    await task();
    logSuccess("Готово", Date.now() - start);
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    logDetail(`Время: ${fmtDuration(Date.now() - start)}`);
    process.exitCode = 1;
  }
}
