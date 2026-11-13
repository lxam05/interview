/*
 * npm run setup
 *
 * Gets a fresh clone ready for development. Never prompts and is safe to run
 * again: every step checks before it changes anything.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { Client } from "pg";
import { loadEnv } from "./env";
import { migrateAndSeed } from "./migrate";

const step = (ok: boolean, text: string) => console.log(`${ok ? "ok  " : "FAIL"}  ${text}`);

function fail(code: string, what: string, fix: string): never {
  process.stderr.write(`error[${code}]: ${what}. fix: ${fix} (retry after the fix)\n`);
  process.exit(1);
}

/** Fill an empty KEY= line in .env with a generated value. Returns true if it wrote one. */
function fillIfEmpty(key: string, make: () => string): boolean {
  const env = fs.readFileSync(".env", "utf8");
  const line = new RegExp(`^${key}=\\s*$`, "m");
  if (!line.test(env)) return false;
  fs.writeFileSync(".env", env.replace(line, `${key}=${make()}`));
  return true;
}

async function databaseExists(adminUrl: string, name: string): Promise<boolean> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const res = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (res.rowCount) return true;
    await client.query(`create database "${name.replace(/"/g, "")}"`);
    return false;
  } finally {
    await client.end();
  }
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) fail("SETUP_NODE_VERSION", `Node ${process.versions.node} is too old`, "install Node 22 or newer (see .nvmrc)");
  step(true, `Node ${process.versions.node}`);

  if (!fs.existsSync(".env")) {
    fs.copyFileSync(".env.example", ".env");
    step(true, "created .env from .env.example");
  } else step(true, ".env exists");
  if (fillIfEmpty("SESSION_SECRET", () => randomBytes(32).toString("hex"))) {
    step(true, "generated SESSION_SECRET in .env");
  }
  if (fillIfEmpty("ADMIN_PASSWORD", () => randomBytes(12).toString("base64url"))) {
    step(true, "generated a local ADMIN_PASSWORD in .env (open the file to read it)");
  }

  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) fail("DB_URL_MISSING", "DATABASE_URL is empty in .env", "set DATABASE_URL=postgres://localhost:5432/interview in .env");

  const targets = [url, process.env.TEST_DATABASE_URL].filter((u): u is string => Boolean(u));
  for (const target of targets) {
    const parsed = new URL(target);
    const name = parsed.pathname.slice(1);
    const admin = new URL(target);
    admin.pathname = "/postgres";
    try {
      const existed = await databaseExists(admin.href, name);
      step(true, existed ? `database "${name}" exists` : `created database "${name}"`);
    } catch {
      fail(
        "DB_UNREACHABLE",
        `cannot reach Postgres at ${parsed.host}`,
        "brew install postgresql@17 && brew services start postgresql@17, then npm run setup",
      );
    }
    await migrateAndSeed(target);
    step(true, `migrations and reference data applied to "${name}"`);
  }

  console.log("\nReady. Next:\n  npm run dev              start the site at http://localhost:3000\n  npm run research:worker  execute research runs queued from /admin\n  npm run demo             see a sample brief (no keys needed)");
}

main().catch((err) => {
  process.stderr.write(`error[SETUP_FAILED]: ${err instanceof Error ? err.message : String(err)}. fix: read the message above, then run npm run setup again (retry after the fix)\n`);
  process.exit(1);
});
