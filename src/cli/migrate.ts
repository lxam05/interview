/*
 * npm run db:migrate
 *
 * Applies pending migrations to the database named by DATABASE_URL and makes
 * sure the reference data (topics, roles, locations, resources) exists.
 * Migrations are additive and forward-only.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedReference } from "@/db/seed";
import { loadEnv, reportError } from "./env";

export async function migrateAndSeed(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedReference(db as unknown as Db);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write(
      "error[DB_URL_MISSING]: DATABASE_URL is not set. fix: npm run setup (retry after the fix; nothing written)\n",
    );
    process.exitCode = 1;
  } else {
    migrateAndSeed(url)
      .then(() => console.log("Database is up to date."))
      .catch(reportError);
  }
}
