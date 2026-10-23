import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {} // no .env: unit tests still run, integration tests skip

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    env: process.env.TEST_DATABASE_URL ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {},
    globalSetup: ["./tests/db-setup.ts"],
    fileParallelism: false, // integration tests share one database
  },
});
