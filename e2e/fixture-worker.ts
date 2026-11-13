/*
 * Stands in for `npm run research:worker` in the e2e test: carries out every
 * queued run with the recorded fixture documents and extraction, so the
 * journey covers queue -> worker -> claims without network or keys.
 */
import { closeDb, getDb } from "../src/db/client";
import { errors } from "../src/research/errors";
import { executeRun } from "../src/research/run";
import * as store from "../src/research/store";
import { createFixtureLlm, SYNTHETIC_FIXTURES } from "../fixtures/synthetic";

async function main() {
  const db = getDb();
  let ran = 0;
  for (let id = await store.nextQueuedRunId(db); id !== null; id = await store.nextQueuedRunId(db)) {
    const summary = await executeRun(db, id, {
      adapters: [],
      adapterContext: { fetch, env: {} },
      retriever: {
        retrieve: async (c) => {
          if (c.text === undefined) throw errors.blockedAddress(c.url, "the e2e worker never uses the network");
          return { url: c.url, platform: c.platform, title: c.title, publishedAt: c.publishedAt ?? null, text: c.text, truncated: false };
        },
      },
      llm: createFixtureLlm(),
      extraCandidates: SYNTHETIC_FIXTURES.map((f) => f.candidate),
    });
    console.log(`run ${id}: ${summary.status}, ${summary.stats.claims} claims`);
    ran++;
  }
  if (!ran) throw new Error("No queued run found.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
