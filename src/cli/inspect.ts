/*
 * npm run research:inspect -- --list | --run <id> | --company "<name>" --preview
 *
 * Read-only views of research results for a reviewer or an agent.
 */
import { parseArgs } from "node:util";
import { desc, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import {
  claims,
  companies,
  programmes,
  researchRunEvents,
  researchRuns,
  sourceDocuments,
  sources,
} from "@/db/schema";
import { errors } from "@/research/errors";
import * as store from "@/research/store";
import { buildBriefContent } from "@/research/synthesise";
import { loadEnv, reportError } from "./env";
import { formatWhen, renderBrief } from "./print";

const HELP = `Usage: npm run research:inspect -- [options]

  --list                 recent research runs
  --run <id>             one run: what happened, sources, extracted claims with quotes
  --company <name>       with --preview: a draft ranking for that company
  --preview              rank UNREVIEWED claims to see what a brief would look like
  --json                 print JSON
  --help                 show this help`;

async function main() {
  const { values } = parseArgs({
    options: {
      list: { type: "boolean" },
      run: { type: "string" },
      company: { type: "string" },
      preview: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help || (!values.list && !values.run && !values.company)) return void console.log(HELP);
  loadEnv();
  const db = getDb();
  const out = (text: string, data: unknown) => console.log(values.json ? JSON.stringify(data) : text);

  if (values.list) {
    const rows = await db
      .select({ run: researchRuns, company: companies.name })
      .from(researchRuns)
      .innerJoin(programmes, eq(programmes.id, researchRuns.programmeId))
      .innerJoin(companies, eq(companies.id, programmes.companyId))
      .orderBy(desc(researchRuns.id))
      .limit(20);
    const text = rows.length
      ? rows
          .map(
            ({ run, company }) =>
              `#${run.id}  ${run.status.padEnd(9)}  ${company}  $${Number(run.costUsd).toFixed(4)}  ${run.queuedAt.toISOString().slice(0, 16)}`,
          )
          .join("\n")
      : "No runs yet.";
    return out(text, rows);
  }

  if (values.run) {
    const run = await store.getRun(db, Number(values.run));
    const events = await db
      .select()
      .from(researchRunEvents)
      .where(eq(researchRunEvents.runId, run.id))
      .orderBy(researchRunEvents.id);
    const sourceRows = await store.runSources(db, run.id);
    const claimRows = await db
      .select({ claim: claims, url: sources.canonicalUrl })
      .from(claims)
      .innerJoin(sourceDocuments, eq(sourceDocuments.id, claims.sourceDocumentId))
      .innerJoin(sources, eq(sources.id, sourceDocuments.sourceId))
      .where(eq(claims.runId, run.id))
      .orderBy(claims.id);

    const text = [
      `Run #${run.id}: ${run.status}${run.error ? ` (${run.error})` : ""}, cost $${Number(run.costUsd).toFixed(4)}`,
      `Stats: ${Object.entries(run.stats).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
      "",
      `SOURCES (${sourceRows.length})`,
      ...sourceRows.map(
        (s) => `  [${s.status}] ${s.platform}  ${s.canonicalUrl}${s.statusReason ? `\n      ${s.statusReason}` : ""}`,
      ),
      "",
      `PROBLEMS (${events.filter((e) => e.outcome === "error").length})`,
      ...events
        .filter((e) => e.outcome === "error")
        .map((e) => `  ${e.stage}: [${e.errorCode}] ${e.message}`),
      "",
      `CLAIMS (${claimRows.length})`,
      ...claimRows.flatMap(({ claim: c, url }) => [
        `  #${c.id} [${c.status}] ${c.type}${c.stage ? ` / ${c.stage}` : ""}: ${c.statement}`,
        `      "${c.quote}"`,
        `      ${c.roleLevel}, ${c.region}, firsthand=${c.firsthand}, ${formatWhen(c.interviewYear, c.interviewMonth)}  ${url}`,
      ]),
    ].join("\n");
    return out(text, { run, events, sources: sourceRows, claims: claimRows });
  }

  if (values.company) {
    const company = await store.findCompany(db, values.company);
    if (!company) throw errors.companyNotFound(values.company);
    const progs = await db.select().from(programmes).where(eq(programmes.companyId, company.id));
    const results = [];
    for (const programme of progs) {
      const evidence = await store.loadEvidenceClaims(
        db,
        programme.id,
        values.preview ? ["extracted", "approved"] : ["approved"],
      );
      const content = buildBriefContent({ claims: evidence, ...(await store.loadTopicCatalogue(db)) });
      const urls = await db.select({ id: sources.id, url: sources.canonicalUrl }).from(sources);
      const urlOf = new Map(urls.map((s) => [`source:${s.id}`, s.url]));
      const heading = values.preview
        ? `PREVIEW from UNREVIEWED claims, not a brief: ${company.name} / ${programme.slug}`
        : `Approved evidence: ${company.name} / ${programme.slug}`;
      results.push({ programme: programme.slug, content, text: renderBrief(heading, content, evidence, urlOf) });
    }
    return out(results.map((r) => r.text).join("\n\n"), results.map(({ programme, content }) => ({ programme, content })));
  }
}

main()
  .catch(reportError)
  .finally(() => closeDb());
