import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createFixtureLlm, SYNTHETIC_COMPANY, SYNTHETIC_FIXTURES } from "../../fixtures/synthetic";
import type { Db } from "@/db/client";
import { claims, researchRunEvents, researchRuns, sourceDocuments, sources, usageEvents } from "@/db/schema";
import type { SourceAdapter } from "@/research/adapters";
import { errors, ResearchError } from "@/research/errors";
import type { ExtractionLlm } from "@/research/extract";
import { executeRun, type RunDeps } from "@/research/run";
import * as store from "@/research/store";
import { buildBriefContent } from "@/research/synthesise";
import { testDb } from "../helpers/db";

const passthroughRetriever: RunDeps["retriever"] = {
  retrieve: async (c) => {
    if (c.text === undefined) throw errors.fetchStatus(c.url, 404);
    return { url: c.url, platform: c.platform, title: c.title, publishedAt: c.publishedAt ?? null, text: c.text, truncated: false };
  },
};

function deps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    adapters: [],
    adapterContext: { fetch, env: {} },
    retriever: passthroughRetriever,
    llm: createFixtureLlm(),
    extraCandidates: SYNTHETIC_FIXTURES.map((f) => f.candidate),
    ...over,
  };
}

async function setup(db: Db) {
  const company = await store.upsertCompany(db, { ...SYNTHETIC_COMPANY, isSynthetic: true });
  const programme = await store.ensureProgramme(db, { companyId: company.id, locationSlug: "dublin", isSynthetic: true });
  const run = await store.queueRun(db, { programmeId: programme.id, isSynthetic: true });
  return { company, programme, run };
}

describe("executeRun", () => {
  it("runs the fixtures end to end and stores traceable, synthetic-flagged evidence", async () => {
    const db = await testDb();
    const { programme, run } = await setup(db);
    const summary = await executeRun(db, run.id, deps());

    expect(summary.status).toBe("succeeded");
    expect(summary.stats).toMatchObject({ sources: 7, documents: 7, claims: 19, claimsDropped: 1, irrelevant: 1 });

    const stored = await db.select().from(claims).where(eq(claims.programmeId, programme.id));
    expect(stored).toHaveLength(19);
    expect(stored.every((c) => c.isSynthetic && c.status === "extracted")).toBe(true);
    expect(stored.every((c) => c.extractorVersion && c.model === "fixture-recorded")).toBe(true);

    // Every stored quote really is in the stored document it points at.
    const docs = new Map((await db.select().from(sourceDocuments)).map((d) => [d.id, d.text]));
    for (const c of stored) expect(docs.get(c.sourceDocumentId)).toContain(c.quote);

    const sourceRows = await db.select().from(sources);
    expect(sourceRows.every((s) => s.isSynthetic)).toBe(true);

    const [saved] = await db.select().from(researchRuns).where(eq(researchRuns.id, run.id));
    expect(saved.status).toBe("succeeded");
    expect(saved.finishedAt).not.toBeNull();
  });

  it("counts a repost once when building the brief, and ignores the injected instruction", async () => {
    const db = await testDb();
    const { programme, run } = await setup(db);
    await executeRun(db, run.id, deps());
    await db.update(claims).set({ status: "approved" }).where(eq(claims.programmeId, programme.id));

    const evidence = await store.loadEvidenceClaims(db, programme.id, ["approved"]);
    const content = buildBriefContent({ claims: evidence, ...(await store.loadTopicCatalogue(db)), now: new Date("2026-11-01") });
    const bySlug = new Map(content.topics.map((t) => [t.topicSlug, t]));

    // Blog A + its repost + blog B = two independent reports, not three.
    expect(bySlug.get("data-structures")).toMatchObject({ label: "multiple_reports", independentReports: 2 });
    expect(bySlug.get("system-design-basics")?.label).toBe("international");
    expect(bySlug.get("operating-systems")?.label).toBe("unverified");
    expect(JSON.stringify(content)).not.toMatch(/blockchain/i);
  });

  it("loads only the claim statuses asked for", async () => {
    const db = await testDb();
    const { programme, run } = await setup(db);
    await executeRun(db, run.id, deps());
    expect(await store.loadEvidenceClaims(db, programme.id, ["approved"])).toHaveLength(0);
    expect(await store.loadEvidenceClaims(db, programme.id, ["extracted"])).toHaveLength(19);
  });

  it("skips finished documents when a run is continued", async () => {
    const db = await testDb();
    const { programme, run } = await setup(db);
    await executeRun(db, run.id, deps());
    await store.requeueRun(db, run.id);
    const again = await executeRun(db, run.id, deps());
    expect(again.stats.documentsSkipped).toBe(7);
    expect(again.stats.claims).toBe(0);
    expect(await db.select().from(claims).where(eq(claims.programmeId, programme.id))).toHaveLength(19);
    expect(await db.select().from(sourceDocuments)).toHaveLength(7);
  });

  it("ends partial with a named problem when there is no model key", async () => {
    const db = await testDb();
    const { run } = await setup(db);
    const summary = await executeRun(db, run.id, deps({ llm: null }));
    expect(summary.status).toBe("partial");
    expect(summary.problems.map((p) => p.code)).toEqual(["RESEARCH_LLM_KEY_MISSING"]);
    expect(await db.select().from(sourceDocuments)).toHaveLength(7);
    expect(await db.select().from(claims)).toHaveLength(0);
  });

  it("keeps going when one document fails and records which", async () => {
    const db = await testDb();
    const { run } = await setup(db);
    const fixture = createFixtureLlm();
    const flaky: ExtractionLlm = {
      model: fixture.model,
      extract: async (prompt) => {
        if (prompt.user.includes("devnotes.example.invalid")) throw errors.llmTransient("HTTP 529");
        return fixture.extract(prompt);
      },
    };
    const summary = await executeRun(db, run.id, deps({ llm: flaky }));
    expect(summary.status).toBe("partial");
    expect(summary.stats.documentsFailed).toBe(1);
    const events = await db.select().from(researchRunEvents).where(eq(researchRunEvents.errorCode, "RESEARCH_LLM_TRANSIENT"));
    expect(events).toHaveLength(1);
    expect(events[0].sourceId).not.toBeNull();
  });

  it("marks sources that could not be fetched, with the reason", async () => {
    const db = await testDb();
    const { run } = await setup(db);
    const summary = await executeRun(
      db,
      run.id,
      deps({ extraCandidates: [{ url: "https://gone.example.invalid/x", title: null, snippet: null, platform: "web" }] }),
    );
    expect(summary.status).toBe("partial");
    const [source] = await db.select().from(sources);
    expect(source.status).toBe("unavailable");
    expect(source.statusReason).toContain("404");
  });

  it("stops at the cost limit and keeps what was already done", async () => {
    const db = await testDb();
    const { programme } = await setup(db).then(async (s) => {
      await db.update(researchRuns).set({ status: "failed" }).where(eq(researchRuns.id, s.run.id));
      return s;
    });
    const run = await store.queueRun(db, { programmeId: programme.id, maxCostUsd: 0.025, isSynthetic: true });
    const fixture = createFixtureLlm();
    let inFlight = 0;
    let maxInFlight = 0;
    const priced: ExtractionLlm = {
      model: fixture.model,
      extract: async (prompt) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        const res = await fixture.extract(prompt);
        inFlight--;
        return { ...res, usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.01 } };
      },
    };
    const summary = await executeRun(db, run.id, deps({ llm: priced }));
    expect(summary.status).toBe("partial");
    expect(summary.problems.at(-1)?.code).toBe("RESEARCH_BUDGET_EXCEEDED");
    expect(summary.stats.documentsSkipped + summary.stats.documents).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect((await db.select().from(usageEvents)).length).toBeGreaterThan(0);
    expect((await db.select().from(usageEvents)).length).toBeLessThan(7);
  });

  it("uses adapters, caches their queries, and survives one adapter failing", async () => {
    const db = await testDb();
    const { programme, run } = await setup(db);
    let searches = 0;
    const good: SourceAdapter = {
      name: "good",
      kind: "keyword",
      costPerCallUsd: 0,
      enabled: () => true,
      search: async () => {
        searches++;
        return [SYNTHETIC_FIXTURES[1].candidate];
      },
    };
    const broken: SourceAdapter = {
      name: "broken",
      kind: "keyword",
      costPerCallUsd: 0,
      enabled: () => true,
      search: async () => {
        throw errors.adapterAuth("broken", "BROKEN_KEY");
      },
    };
    const first = await executeRun(db, run.id, deps({ adapters: [broken, good], extraCandidates: [] }));
    expect(first.status).toBe("partial");
    expect(first.problems[0].code).toBe("RESEARCH_ADAPTER_AUTH");
    expect(first.stats.sources).toBe(1);
    expect(first.stats.claims).toBe(6);
    const searchesAfterFirst = searches;

    // A second run reuses cached queries and the sources already found.
    const next = await store.queueRun(db, { programmeId: programme.id, isSynthetic: true });
    const second = await executeRun(db, next.id, deps({ adapters: [good], extraCandidates: [] }));
    expect(searches).toBe(searchesAfterFirst);
    expect(second.stats.queriesCached).toBeGreaterThan(0);
    expect(second.stats.sources).toBe(1);
    expect(second.stats.documentsSkipped).toBe(1);
  });

  it("marks the run failed and rethrows on an unexpected error", async () => {
    const db = await testDb();
    const { run } = await setup(db);
    const exploding: RunDeps["retriever"] = {
      retrieve: async () => {
        throw new TypeError("boom");
      },
    };
    await expect(executeRun(db, run.id, deps({ retriever: exploding }))).rejects.toThrow("boom");
    const [saved] = await db.select().from(researchRuns).where(eq(researchRuns.id, run.id));
    expect(saved.status).toBe("failed");
    expect(saved.error).toBe("WORKER_UNEXPECTED");
  });
});

describe("run queue", () => {
  it("refuses a second active run for a programme with a named error", async () => {
    const db = await testDb();
    const { programme } = await setup(db);
    await expect(store.queueRun(db, { programmeId: programme.id })).rejects.toBeInstanceOf(ResearchError);
    await expect(store.queueRun(db, { programmeId: programme.id })).rejects.toMatchObject({ code: "RESEARCH_RUN_ACTIVE" });
  });

  it("claims the oldest queued run once", async () => {
    const db = await testDb();
    const { run } = await setup(db);
    expect(await store.nextQueuedRunId(db)).toBe(run.id);
    expect(await store.claimRun(db, run.id)).toBe(true);
    expect(await store.claimRun(db, run.id)).toBe(false);
    expect(await store.nextQueuedRunId(db)).toBeNull();
  });

  it("fails runs whose heartbeat stopped, and leaves live ones alone", async () => {
    const db = await testDb();
    const { run } = await setup(db);
    await store.claimRun(db, run.id);
    expect(await store.failStaleRuns(db, new Date())).toEqual([]);
    const later = new Date(Date.now() + 11 * 60_000);
    expect(await store.failStaleRuns(db, later)).toEqual([run.id]);
    const [saved] = await db.select().from(researchRuns).where(eq(researchRuns.id, run.id));
    expect(saved).toMatchObject({ status: "failed", error: "RESEARCH_RUN_STALE" });
    // A stale run can be continued.
    await store.requeueRun(db, run.id);
    expect(await store.nextQueuedRunId(db)).toBe(run.id);
  });

  it("finds companies by name, slug and alias", async () => {
    const db = await testDb();
    const { company } = await setup(db);
    expect((await store.findCompany(db, "northwind"))?.id).toBe(company.id);
    expect((await store.findCompany(db, "Northwind Labs (Synthetic)"))?.id).toBe(company.id);
    expect(await store.findCompany(db, "Nobody")).toBeNull();
  });
});

describe("source policy in a run", () => {
  it("drops excluded search results before storing them", async () => {
    const db = await testDb();
    const { run } = await setup(db);
    const adapter: SourceAdapter = {
      name: "fake",
      kind: "web",
      costPerCallUsd: 0,
      enabled: () => true,
      search: async () => [
        { url: "https://www.glassdoor.ie/Interview/x.htm", title: "x", snippet: null, platform: "web" },
        { url: "https://rocketreach.co/someone", title: "x", snippet: null, platform: "web" },
      ],
    };
    const summary = await executeRun(db, run.id, deps({ adapters: [adapter], extraCandidates: [] }));
    expect(summary.stats.excluded).toBeGreaterThan(0);
    const stored = await db.select().from(sources);
    expect(stored.some((s) => /glassdoor|rocketreach/.test(s.canonicalUrl))).toBe(false);
  });
});
