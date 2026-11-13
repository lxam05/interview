/*
 * npm run research -- --company "<name>" [options]
 *
 * Runs research for one internship programme. Never prompts. Results go to
 * stdout (plain text, or JSON with --json); progress and errors go to stderr.
 * Exit code is 0 only when the command did what was asked.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@/db/client";
import { enabledAdapters } from "@/research/adapters";
import { slugify } from "@/research/dedupe";
import { errors, formatError, ResearchError } from "@/research/errors";
import { liveDeps } from "@/research/live";
import { buildKeywordQueries, buildQueries } from "@/research/queries";
import { executeRun } from "@/research/run";
import * as store from "@/research/store";
import { loadEnv, reportError, writeTrace } from "./env";

const HELP = `Usage: npm run research -- [options]

Research one internship programme and store the evidence for review.

  --company <name>        company to research (must exist; see --add-company)
  --location <place>      Dublin, Cork, Galway, Limerick (default: anywhere in Ireland)
  --cycle <text>          recruitment cycle, e.g. "Summer 2027"
  --add-company <name>    create the company first, then research it
  --alias <name>          another name for the company (repeatable, with --add-company)
  --official-url <url>    the employer's own recruitment page (with --add-company)
  --run <id>              continue an earlier run instead of starting a new one
  --queue                 only queue the run; \`npm run research:worker\` executes it
  --dry-run               show the searches that would run and what they cost; call nothing
  --max-cost <usd>        stop the run when it has spent this much (default RESEARCH_MAX_COST_USD or 2)
  --list-companies        list known companies
  --json                  print the result as JSON
  --verbose               print full error traces
  --help                  show this help

Examples:
  npm run research -- --add-company "Acme" --official-url https://acme.example/careers --dry-run
  keysmith run -- npm run research -- --company "Acme" --location Dublin --max-cost 1
  npm run research:inspect -- --run 3`;

async function main() {
  const { values } = parseArgs({
    options: {
      company: { type: "string" },
      location: { type: "string" },
      cycle: { type: "string" },
      "add-company": { type: "string" },
      alias: { type: "string", multiple: true },
      "official-url": { type: "string" },
      run: { type: "string" },
      queue: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "max-cost": { type: "string" },
      "list-companies": { type: "boolean" },
      json: { type: "boolean" },
      verbose: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return void console.log(HELP);
  loadEnv();
  const out = (text: string, data: unknown) => console.log(values.json ? JSON.stringify(data) : text);
  const maxCost = values["max-cost"] ? Number(values["max-cost"]) : null;
  if (maxCost !== null && !(maxCost > 0)) {
    throw new ResearchError("RESEARCH_BUDGET_EXCEEDED", `--max-cost "${values["max-cost"]}" is not a positive number`, {
      fix: "pass a number of US dollars, e.g. --max-cost 1.50",
      retry: "fix_then_retry",
    });
  }

  const db = getDb();

  if (values["list-companies"]) {
    const all = await store.listCompanies(db);
    return out(all.length ? all.map((c) => `${c.name}${c.isSynthetic ? " (synthetic)" : ""}`).join("\n") : "No companies yet.", all);
  }

  if (values["add-company"]) {
    await store.upsertCompany(db, {
      name: values["add-company"],
      aliases: values.alias,
      website: values["official-url"] ?? null,
    });
  }

  // Continue an earlier run.
  let runId: number;
  let programmeId: number;
  if (values.run) {
    const run = await store.requeueRun(db, Number(values.run), maxCost);
    runId = run.id;
    programmeId = run.programmeId;
  } else {
    const name = values.company ?? values["add-company"];
    if (!name) {
      console.error(HELP);
      process.exitCode = 2;
      return;
    }
    const company = await store.findCompany(db, name);
    if (!company) throw errors.companyNotFound(name);
    const programme = await store.ensureProgramme(db, {
      companyId: company.id,
      locationSlug: values.location ? slugify(values.location) : null,
      cycle: values.cycle ?? null,
    });
    programmeId = programme.id;

    if (values["dry-run"]) {
      const input = await store.loadResearchInput(db, programmeId);
      const plan = enabledAdapters(process.env).map((a) => {
        const queries = a.kind === "web" ? buildQueries(input) : buildKeywordQueries(input);
        return { adapter: a.name, queries, costUsd: queries.length * a.costPerCallUsd };
      });
      const searchCost = plan.reduce((sum, p) => sum + p.costUsd, 0);
      const text = [
        `Dry run for ${input.company}, ${input.role}, ${input.location ?? "Ireland"}. Nothing was called.`,
        ...plan.flatMap((p) => [`\n${p.adapter} (${p.queries.length} searches, about $${p.costUsd.toFixed(3)}):`, ...p.queries.map((q) => `  ${q}`)]),
        `\nEmployer pages: ${input.officialUrls?.length ? input.officialUrls.join(", ") : "none given"}`,
        `Model extraction: ${process.env.ANTHROPIC_API_KEY ? "on" : "off (ANTHROPIC_API_KEY not set)"}; its cost depends on how many pages are found.`,
        `Estimated search cost: $${searchCost.toFixed(3)}. Web search adapters not listed above are off because their key is not set.`,
      ].join("\n");
      return out(text, { dryRun: true, plan, searchCostUsd: searchCost });
    }

    const run = await store.queueRun(db, { programmeId, maxCostUsd: maxCost });
    runId = run.id;
  }

  if (values.queue) {
    return out(`Queued run ${runId}. Start the worker with: npm run research:worker`, { runId, status: "queued" });
  }

  try {
    const summary = await executeRun(db, runId, liveDeps(process.env));
    const s = summary.stats;
    const text = [
      `Run ${summary.runId}: ${summary.status}.`,
      `${s.sources} sources, ${s.documents} documents (${s.documentsFailed} failed, ${s.documentsSkipped} already done), ` +
        `${s.claims} claims kept, ${s.claimsDropped} dropped (quote not in source).`,
      `Cost: $${summary.costUsd.toFixed(4)}.`,
      ...summary.problems.map((p) => `  problem[${p.code}]: ${p.message}`),
      `Next: npm run research:inspect -- --run ${summary.runId}`,
    ].join("\n");
    out(text, summary);
    if (summary.status !== "succeeded") process.exitCode = 3;
  } catch (err) {
    if (err instanceof ResearchError) throw err;
    const stage = (err as { stage?: string }).stage ?? "unknown";
    const trace = writeTrace(err, `run-${runId}`);
    process.stderr.write(`${formatError(errors.workerUnexpected(runId, stage, trace, err))}\n`);
    process.exitCode = 1;
  }
}

main()
  .catch(reportError)
  .finally(() => closeDb());
