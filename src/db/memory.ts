import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

/**
 * A fresh in-memory Postgres (PGlite) with every migration applied.
 * Used by unit/integration tests and by `npm run demo`. Never by the web app.
 */
export async function createMemoryDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db: db as unknown as Db, close: () => client.close() };
}
