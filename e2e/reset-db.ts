/*
 * Creates the e2e database if needed, migrates it, empties every table and
 * re-seeds reference data. Runs before the e2e server starts.
 */
import { Client } from "pg";
import { migrateAndSeed } from "../src/cli/migrate";
import { E2E_DATABASE_URL } from "./env";

async function main() {
  const url = new URL(E2E_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_e2e$/.test(name)) throw new Error(`Refusing to reset "${name}": e2e database names must end in _e2e.`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  try {
    await c.connect();
  } catch (err) {
    throw new Error(`Postgres is not reachable at ${admin.host}. fix: start Postgres (docs/runbook.md). ${(err as Error).message}`);
  }
  const { rowCount } = await c.query("select 1 from pg_database where datname = $1", [name]);
  if (!rowCount) await c.query(`create database "${name}"`);
  await c.end();

  await migrateAndSeed(E2E_DATABASE_URL);
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'",
  );
  await db.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  await db.end();
  await migrateAndSeed(E2E_DATABASE_URL);
  console.log(`e2e database ${name} is empty and seeded`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
