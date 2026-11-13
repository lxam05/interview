import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * The one database type the app uses. Real Postgres (node-postgres) and the
 * in-memory PGlite database used by tests and the demo both satisfy it.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class DbConfigError extends Error {
  readonly code = "DB_URL_MISSING";
  constructor() {
    super(
      "DATABASE_URL is not set. fix: run `npm run setup` (it creates .env), or use `npm run demo`, which needs no database.",
    );
  }
}

let pool: Pool | undefined;
let db: Db | undefined;

/** The shared Postgres connection for the web app, worker and CLI. */
export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbConfigError();
  pool = new Pool({ connectionString: url, max: 10 });
  db = drizzle(pool, { schema }) as unknown as Db;
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

export { schema };
