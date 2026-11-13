import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Public pages read data only through src/briefs/read.ts, which applies
  // "published and not synthetic" in one place.
  {
    files: ["src/app/(public)/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/db", "@/db/*", "drizzle-orm", "drizzle-orm/*", "pg"], message: "Public pages read data only through @/briefs/read." },
            { group: ["@/research/*", "@/admin/queries"], message: "Public pages read data only through @/briefs/read." },
            { group: ["@/briefs/public"], allowTypeImports: true, message: "Use the cached readers in @/briefs/read." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "traces/**",
  ]),
]);

export default eslintConfig;
