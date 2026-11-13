import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CANONICAL_TOPICS } from "@/domain/constants";
import { seedReference } from "@/db/seed";
import {
  briefs,
  briefVersions,
  companies,
  programmes,
  researchRuns,
  roles,
  sources,
  topics,
} from "@/db/schema";
import { testDb } from "../helpers/db";

async function programme(db: Awaited<ReturnType<typeof testDb>>) {
  const [company] = await db
    .insert(companies)
    .values({ slug: "synthetic-co", name: "Synthetic Co", isSynthetic: true })
    .returning();
  const [role] = await db.select().from(roles);
  const [p] = await db
    .insert(programmes)
    .values({ companyId: company.id, roleId: role.id, slug: "swe-intern", isSynthetic: true })
    .returning();
  return p;
}

const emptyContent = { topics: [], stages: [], advice: [], limitations: [], generatedAt: "t" };

describe("schema", () => {
  it("migrates and seeds reference data once, however often seeding runs", async () => {
    const db = await testDb();
    await seedReference(db);
    const rows = await db.select().from(topics);
    expect(rows.map((r) => r.slug).sort()).toEqual(CANONICAL_TOPICS.map((t) => t.slug).sort());
  });

  it("defaults new rows to non-synthetic and keeps the flag when set", async () => {
    const db = await testDb();
    const [real] = await db.insert(companies).values({ slug: "a", name: "A" }).returning();
    expect(real.isSynthetic).toBe(false);
    const p = await programme(db);
    expect(p.isSynthetic).toBe(true);
  });

  it("stores each source URL once", async () => {
    const db = await testDb();
    await db.insert(sources).values({ canonicalUrl: "https://example.com/a", platform: "web" });
    await expect(
      db.insert(sources).values({ canonicalUrl: "https://example.com/a", platform: "web" }),
    ).rejects.toThrow();
  });

  it("allows only one queued or running run per programme", async () => {
    const db = await testDb();
    const p = await programme(db);
    const [first] = await db.insert(researchRuns).values({ programmeId: p.id }).returning();
    await expect(db.insert(researchRuns).values({ programmeId: p.id })).rejects.toThrow();
    await db.update(researchRuns).set({ status: "succeeded" }).where(eq(researchRuns.id, first.id));
    await db.insert(researchRuns).values({ programmeId: p.id });
  });

  it("allows only one published version per brief", async () => {
    const db = await testDb();
    const p = await programme(db);
    const [brief] = await db.insert(briefs).values({ programmeId: p.id }).returning();
    await db
      .insert(briefVersions)
      .values({ briefId: brief.id, version: 1, status: "published", content: emptyContent });
    await expect(
      db
        .insert(briefVersions)
        .values({ briefId: brief.id, version: 2, status: "published", content: emptyContent }),
    ).rejects.toThrow();
  });
});
