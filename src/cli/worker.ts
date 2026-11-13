/*
 * npm run research:worker [-- --once]
 *
 * Executes queued research runs, one at a time, oldest first. The admin
 * screen's "Run research" button only queues a run; this process does the work.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@/db/client";
import { log } from "@/lib/log";
import { errors, formatError, ResearchError } from "@/research/errors";
import { liveDeps } from "@/research/live";
import { executeRun } from "@/research/run";
import * as store from "@/research/store";
import { loadEnv, reportError, writeTrace } from "./env";

const HELP = `Usage: npm run research:worker -- [options]

Executes queued research runs until stopped (Ctrl+C).

  --once            process everything queued, then exit
  --interval <ms>   how often to look for new runs (default 5000)
  --help            show this help`;

async function main() {
  const { values } = parseArgs({
    options: { once: { type: "boolean" }, interval: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help) return void console.log(HELP);
  loadEnv();
  const interval = Number(values.interval ?? 5000);
  const db = getDb();
  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));
  log("worker.started", { once: Boolean(values.once) });

  while (!stopping) {
    for (const id of await store.failStaleRuns(db)) {
      process.stderr.write(`${formatError(errors.runStale(id))}\n`);
    }
    const runId = await store.nextQueuedRunId(db);
    if (runId === null) {
      if (values.once) break;
      await new Promise((r) => setTimeout(r, interval));
      continue;
    }
    try {
      const summary = await executeRun(db, runId, liveDeps(process.env));
      log("worker.run", { runId, status: summary.status, costUsd: summary.costUsd });
    } catch (err) {
      // Another worker took it first: fine, look for the next one.
      if (err instanceof ResearchError && err.code === "RESEARCH_RUN_ACTIVE") continue;
      if (err instanceof ResearchError) {
        process.stderr.write(`${formatError(err)}\n`);
        continue;
      }
      const stage = (err as { stage?: string }).stage ?? "unknown";
      const trace = writeTrace(err, `run-${runId}`);
      process.stderr.write(`${formatError(errors.workerUnexpected(runId, stage, trace, err))}\n`);
    }
  }
  log("worker.stopped");
}

main()
  .catch(reportError)
  .finally(() => closeDb());
