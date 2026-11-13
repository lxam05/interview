import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit and integration tests. They run on in-memory PGlite and need no
// services, no network and no keys.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/pg/**", "node_modules/**"],
    environment: "node",
    testTimeout: 20_000,
  },
});
