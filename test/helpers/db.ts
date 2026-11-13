import { afterEach } from "vitest";
import type { Db } from "@/db/client";
import { createMemoryDb } from "@/db/memory";
import { seedReference } from "@/db/seed";

const open: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (open.length) await open.pop()!();
});

/** A fresh, migrated, seeded in-memory database, closed after the test. */
export async function testDb(): Promise<Db> {
  const { db, close } = await createMemoryDb();
  open.push(close);
  await seedReference(db);
  return db;
}
