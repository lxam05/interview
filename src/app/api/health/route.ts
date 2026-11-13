import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";

/** Liveness and database check for uptime monitors and post-deploy smoke tests. */
export async function GET() {
  await connection();
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, database: "up" });
  } catch (err) {
    // Details go to the server log only; the response never carries connection info.
    console.error(JSON.stringify({ event: "health.db_down", code: (err as { code?: string }).code ?? null }));
    return Response.json({ ok: false, database: "down" }, { status: 503 });
  }
}
