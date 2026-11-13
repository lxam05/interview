import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests that need real concurrency (two connections). They run against a real
// Postgres named by TEST_DATABASE_URL and fail loudly if it is not reachable.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["test/pg/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    env: { LOG_SILENT: "1" },
    fileParallelism: false,
  },
});
