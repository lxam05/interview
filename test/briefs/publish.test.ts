import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createFixtureLlm, SYNTHETIC_COMPANY, SYNTHETIC_FIXTURES } from "../../fixtures/synthetic";
import type { Db } from "@/db/client";
import { briefs, briefVersions, claims } from "@/db/schema";
import { getPublicBrief, listPublishedProgrammes, searchProgrammes, shortQuote, PUBLIC_QUOTE_MAX } from "@/briefs/public";
import {
  approveVersion,
  editDraftText,
  PublishError,
  rejectVersion,
  reviewClaim,
  synthesiseDraft,
  unpublishVersion,
} from "@/briefs/publish";
import { errors } from "@/research/errors";
import { executeRun } from "@/research/run";
import * as store from "@/research/store";
import { testDb } from "../helpers/db";

/**
 * Runs the fixture pipeline for a company. `synthetic: false` stands in for
 * real research so the public read rules can be exercised; it never leaves
 * this in-memory test database.
 */
async function researched(db: Db, opts: { name: string; synthetic: boolean }) {
  const company = await store.upsertCompany(db, {
    name: opts.name,
    aliases: opts.synthetic ? [] : ["TCo"],
    isSynthetic: opts.synthetic,
  });
  const programme = await store.ensureProgramme(db, {
    companyId: company.id,
    locationSlug: "dublin",
    isSynthetic: opts.synthetic,
  });
  const run = await store.queueRun(db, { programmeId: programme.id, isSynthetic: opts.synthetic });
  await executeRun(db, run.id, {
    adapters: [],
    adapterContext: { fetch, env: {} },
    retriever: {
      retrieve: async (c) => {
        if (c.text === undefined) throw errors.fetchStatus(c.url, 404);
        return { url: c.url, platform: c.platform, title: c.title, publishedAt: c.publishedAt ?? null, text: c.text, truncated: false };
      },
    },
    llm: createFixtureLlm(),
    extraCandidates: SYNTHETIC_FIXTURES.map((f) => f.candidate),
  });
  return { company, programme };
}

async function approveAll(db: Db, programmeId: number) {
  await db.update(claims).set({ status: "approved" }).where(eq(claims.programmeId, programmeId));
}

describe("publishing", () => {
  it("never publishes on its own: synthesis writes a draft that a person approves", async () => {
    const db = await testDb();
    const { programme } = await researched(db, { name: "Test Co", synthetic: false });

    await expect(synthesiseDraft(db, programme.id)).rejects.toMatchObject({ problem: "no_claims" });

    await approveAll(db, programme.id);
    const draft = await synthesiseDraft(db, programme.id);
    expect(draft.status).toBe("draft");
    expect(await getPublicBrief(db, "test-co", programme.slug)).toMatchObject({ version: null });

    await approveVersion(db, { versionId: draft.id, rowVersion: draft.rowVersion });
    const brief = await getPublicBrief(db, "test-co", programme.slug);
    expect(brief?.version?.id).toBe(draft.id);
    expect(brief!.version!.content.topics.length).toBeGreaterThan(0);
    // Every cited claim resolves to a public claim with its source.
    for (const t of brief!.version!.content.topics) {
      for (const id of t.claimIds) expect(brief!.claims.get(id)?.source.url).toBeTruthy();
    }
  });

  it("refuses to approve a draft that changed after the reviewer opened it", async () => {
    const db = await testDb();
    const { programme } = await researched(db, { name: "Test Co", synthetic: false });
    await approveAll(db, programme.id);
    const draft = await synthesiseDraft(db, programme.id);
    const slug = draft.content.topics[0].topicSlug;
    await editDraftText(db, { versionId: draft.id, rowVersion: draft.rowVersion, why: { [slug]: "Edited." }, limitations: ["One."] });

    const stale = approveVersion(db, { versionId: draft.id, rowVersion: draft.rowVersion });
    await expect(stale).rejects.toBeInstanceOf(PublishError);
    await expect(stale).rejects.toMatchObject({ problem: "stale" });

    const [fresh] = await db.select().from(briefVersions).where(eq(briefVersions.id, draft.id));
    expect(fresh.content.topics[0].why).toBe("Edited.");
    expect(fresh.content.limitations).toEqual(["One."]);
    await approveVersion(db, { versionId: draft.id, rowVersion: fresh.rowVersion });
  });

  it("refuses to approve a draft citing a claim that was rejected since", async () => {
    const db = await testDb();
    const { programme } = await researched(db, { name: "Test Co", synthetic: false });
    await approveAll(db, programme.id);
    const draft = await synthesiseDraft(db, programme.id);
    const claimId = draft.content.topics[0].claimIds[0];
    await reviewClaim(db, { claimId, decision: "reject" });

    await expect(approveVersion(db, { versionId: draft.id, rowVersion: draft.rowVersion })).rejects.toMatchObject({
      problem: "claims_not_approved",
    });
  });

  it("flags a published brief for review when a claim it cites is rejected", async () => {
    const db = await testDb();
    const { programme } = await researched(db, { name: "Test Co", synthetic: false });
    await approveAll(db, programme.id);
    const draft = await synthesiseDraft(db, programme.id);
    await approveVersion(db, { versionId: draft.id, rowVersion: draft.rowVersion });

    const result = await reviewClaim(db, { claimId: draft.content.topics[0].claimIds[0], decision: "reject" });
    expect(result.flaggedBriefIds).toHaveLength(1);
    const [brief] = await db.select().from(briefs).where(eq(briefs.programmeId, programme.id));
    expect(brief.needsReview).toBe(true);
    expect(brief.needsReviewReason).toMatch(/rejected after publishing/);
  });

  it("keeps one published version: approving v2 unpublishes v1; unpublish hides the page", async () => {
    const db = await testDb();
    const { programme } = await researched(db, { name: "Test Co", synthetic: false });
    await approveAll(db, programme.id);
    const v1 = await synthesiseDraft(db, programme.id);
    await approveVersion(db, { versionId: v1.id, rowVersion: v1.rowVersion });
    const v2 = await synthesiseDraft(db, programme.id);
    expect(v2.version).toBe(2);
    await approveVersion(db, { versionId: v2.id, rowVersion: v2.rowVersion });

    const all = await db.select().from(briefVersions).orderBy(briefVersions.version);
    expect(all.map((v) => v.status)).toEqual(["unpublished", "published"]);

    await unpublishVersion(db, v2.id);
    expect((await getPublicBrief(db, "test-co", programme.slug))?.version).toBeNull();
    await expect(approveVersion(db, { versionId: v2.id, rowVersion: 99 })).rejects.toMatchObject({ problem: "not_draft" });
  });

  it("rejecting a draft keeps it out of public view", async () => {
    const db = await testDb();
    const { programme } = await researched(db, { name: "Test Co", synthetic: false });
    await approveAll(db, programme.id);
    const draft = await synthesiseDraft(db, programme.id);
    await rejectVersion(db, draft.id, "Too thin");
    expect((await getPublicBrief(db, "test-co", programme.slug))?.version).toBeNull();
  });
});

describe("public reads", () => {
  it("never return synthetic companies, programmes or briefs, even when published", async () => {
    const db = await testDb();
    const { programme } = await researched(db, { name: SYNTHETIC_COMPANY.name, synthetic: true });
    await approveAll(db, programme.id);
    const draft = await synthesiseDraft(db, programme.id);
    await approveVersion(db, { versionId: draft.id, rowVersion: draft.rowVersion });

    expect(await searchProgrammes(db, "Northwind")).toEqual([]);
    expect(await searchProgrammes(db, "")).toEqual([]);
    expect(await listPublishedProgrammes(db)).toEqual([]);
    const [company] = await store.listCompanies(db);
    expect(await getPublicBrief(db, company.slug, programme.slug)).toBeNull();
  });

  it("search matches names and aliases case-insensitively and reports coverage", async () => {
    const db = await testDb();
    const { programme } = await researched(db, { name: "Test Co", synthetic: false });
    await store.upsertCompany(db, { name: "Other Ltd" });

    const before = await searchProgrammes(db, "test");
    expect(before).toHaveLength(1);
    expect(before[0].programmes[0]).toMatchObject({ coverage: "not_yet" });
    expect(await searchProgrammes(db, "tco")).toHaveLength(1);
    expect(await searchProgrammes(db, "%")).toEqual([]);

    await approveAll(db, programme.id);
    const draft = await synthesiseDraft(db, programme.id);
    await approveVersion(db, { versionId: draft.id, rowVersion: draft.rowVersion });
    const after = await searchProgrammes(db, "");
    expect(after[0].companyName).toBe("Test Co");
    expect(after[0].programmes[0].coverage).toBe("published");
    expect(after.map((r) => r.companyName)).toContain("Other Ltd");

    expect(await searchProgrammes(db, "test", "cork")).toEqual([]);
    expect(await searchProgrammes(db, "test", "dublin")).toHaveLength(1);
  });

  it("shows short quotes only", () => {
    const long = "word ".repeat(200);
    expect(shortQuote(long).length).toBeLessThanOrEqual(PUBLIC_QUOTE_MAX + 1);
    expect(shortQuote(long).endsWith("…")).toBe(true);
    expect(shortQuote("short")).toBe("short");
  });
});
