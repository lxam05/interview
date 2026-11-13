import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedReference } from "@/db/seed";
import { approveVersion, synthesiseDraft } from "@/briefs/publish";
import * as store from "@/research/store";
import { approveSubmission, submitReport } from "@/submissions";

/*
 * Real concurrency needs real Postgres: two pools act as two processes.
 * Runs against TEST_DATABASE_URL (created by `npm run setup`); every table is
 * emptied first. Fails loudly, never skips, when the database is missing.
 */

const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/interview_test";
let poolA: Pool, poolB: Pool, a: Db, b: Db;

beforeAll(async () => {
  poolA = new Pool({ connectionString: url, max: 4 });
  poolB = new Pool({ connectionString: url, max: 4 });
  try {
    await poolA.query("select 1");
  } catch (err) {
    throw new Error(`TEST_DATABASE_URL (${url}) is not reachable. fix: run \`npm run setup\` with Postgres running. ${(err as Error).message}`);
  }
  a = drizzle(poolA, { schema }) as unknown as Db;
  b = drizzle(poolB, { schema }) as unknown as Db;
  await migrate(a as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const { rows } = await poolA.query(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'",
  );
  await poolA.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  await seedReference(a);
});

afterAll(async () => {
  await poolA?.end();
  await poolB?.end();
});

async function programme(name: string) {
  const company = await store.upsertCompany(a, { name });
  return store.ensureProgramme(a, { companyId: company.id, locationSlug: "dublin" });
}

describe("with two connections", () => {
  it("exactly one worker claims a queued run", async () => {
    const p = await programme("Claim Co");
    const run = await store.queueRun(a, { programmeId: p.id });
    const results = await Promise.all([store.claimRun(a, run.id), store.claimRun(b, run.id), store.claimRun(a, run.id), store.claimRun(b, run.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("only one run per programme can be queued at once", async () => {
    const p = await programme("Queue Co");
    const results = await Promise.allSettled([store.queueRun(a, { programmeId: p.id }), store.queueRun(b, { programmeId: p.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "RESEARCH_RUN_ACTIVE" });
  });

  it("two reviewers approving the same draft publish it once", async () => {
    const p = await programme("Approve Co");
    const sent = await submitReport(
      a,
      {
        companyName: "Approve Co", roleName: "Intern", locationName: "Dublin", interviewYear: new Date().getFullYear(),
        stage: "online_assessment", format: "HackerRank, 90 minutes", topicSlugs: ["algorithms"],
        topics: "Two graph problems on a timed platform.", consent: true, idempotencyKey: crypto.randomUUID(),
      },
      { honeypot: "", startedAt: 0, ipHash: "pg-test" },
    );
    if (!sent.ok) throw new Error("submit failed");
    await approveSubmission(a, { submissionId: sent.id, programmeId: p.id });
    const draft = await synthesiseDraft(a, p.id);
    const results = await Promise.allSettled([
      approveVersion(a, { versionId: draft.id, rowVersion: draft.rowVersion }),
      approveVersion(b, { versionId: draft.id, rowVersion: draft.rowVersion }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ problem: "not_draft" });
    const { rows } = await poolA.query("select count(*)::int as n from brief_versions where status = 'published'");
    expect(rows[0].n).toBe(1);
  });

  it("a double-submitted report is stored once", async () => {
    const key = crypto.randomUUID();
    const body = {
      companyName: "Twice Co", roleName: "Intern", locationName: "Cork", interviewYear: new Date().getFullYear(),
      stage: "phone_screen", format: "Thirty minute call", topicSlugs: [], topics: "CV walk-through and one project.",
      consent: true, idempotencyKey: key,
    };
    const guard = { honeypot: "", startedAt: 0, ipHash: "pg-twice" };
    const [x, y] = await Promise.all([submitReport(a, body, guard), submitReport(b, body, guard)]);
    expect(x.ok && y.ok && x.id === y.id).toBe(true);
    const { rows } = await poolA.query("select count(*)::int as n from submissions where idempotency_key = $1", [key]);
    expect(rows[0].n).toBe(1);
  });
});
