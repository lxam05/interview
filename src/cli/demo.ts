/*
 * npm run demo
 *
 * Runs the real pipeline (discovery hand-off, quote check, de-duplication,
 * evidence labels, ranking, brief building) on the synthetic fixtures, against
 * an in-memory database. Needs no keys, no network and no Postgres.
 */
import { eq } from "drizzle-orm";
import { createFixtureLlm, SYNTHETIC_COMPANY, SYNTHETIC_FIXTURES } from "../../fixtures/synthetic";
import { createMemoryDb } from "@/db/memory";
import { claims, sourceDocuments, sources } from "@/db/schema";
import { seedReference } from "@/db/seed";
import { errors } from "@/research/errors";
import { executeRun } from "@/research/run";
import * as store from "@/research/store";
import { buildBriefContent } from "@/research/synthesise";
import { reportError } from "./env";
import { renderBrief } from "./print";

async function main() {
  process.env.LOG_SILENT = "1";
  const started = Date.now();
  const { db, close } = await createMemoryDb();
  try {
    await seedReference(db);
    const company = await store.upsertCompany(db, { ...SYNTHETIC_COMPANY, isSynthetic: true });
    const programme = await store.ensureProgramme(db, {
      companyId: company.id,
      locationSlug: "dublin",
      isSynthetic: true,
    });
    const run = await store.queueRun(db, {
      programmeId: programme.id,
      requestedBy: "demo",
      isSynthetic: true,
    });

    const summary = await executeRun(db, run.id, {
      adapters: [],
      adapterContext: { fetch, env: {} },
      // Every fixture carries its text, so nothing may be fetched.
      retriever: {
        retrieve: async (c) => {
          if (c.text === undefined) throw errors.blockedAddress(c.url, "the demo never uses the network");
          return {
            url: c.url,
            platform: c.platform,
            title: c.title,
            publishedAt: c.publishedAt ?? null,
            text: c.text,
            truncated: false,
          };
        },
      },
      llm: createFixtureLlm(),
      extraCandidates: SYNTHETIC_FIXTURES.map((f) => f.candidate),
    });

    // In the real product a person reviews each claim. The demo approves them
    // all so there is a brief to show.
    await db.update(claims).set({ status: "approved" }).where(eq(claims.programmeId, programme.id));

    const evidence = await store.loadEvidenceClaims(db, programme.id, ["approved"]);
    const catalogue = await store.loadTopicCatalogue(db);
    const content = buildBriefContent({ claims: evidence, ...catalogue });

    const sourceRows = await db
      .select({ id: sources.id, url: sources.canonicalUrl })
      .from(sources)
      .innerJoin(sourceDocuments, eq(sourceDocuments.sourceId, sources.id));
    const urlOf = new Map(sourceRows.map((s) => [`source:${s.id}`, s.url]));

    const banner = "SYNTHETIC DEMO DATA: this company and every document below are invented.";
    console.log(`${banner}\n`);
    console.log(
      renderBrief(`${company.name}: Software Engineering Intern, Dublin`, content, evidence, urlOf),
    );
    console.log(
      `\nRun: ${summary.status}. ${summary.stats.documents} documents, ${summary.stats.claims} claims kept, ` +
        `${summary.stats.claimsDropped} dropped (quote not in source), ${summary.stats.irrelevant} irrelevant document, ` +
        `cost $${summary.costUsd.toFixed(2)}, ${((Date.now() - started) / 1000).toFixed(1)}s.`,
    );
    console.log(`\n${banner}`);
  } finally {
    await close();
  }
}

main().catch(reportError);
