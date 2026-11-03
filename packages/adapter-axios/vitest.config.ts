import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    restoreMocks: true,
    mockReset: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html"],
      thresholds: {
        100: true,
      },
    },
  },
  resolve: {
    alias: {
      src: fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
