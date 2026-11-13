import { createHmac } from "node:crypto";
import { and, count, eq, gt, isNotNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { corrections, rateLimits, submissions } from "@/db/schema";

/*
 * Abuse protection for public forms: keyed IP hashes, a rolling rate limit,
 * and the 30-day clean-up that deletes them.
 */

export const IP_HASH_RETENTION_DAYS = 30;

export const RATE_LIMITS = {
  submission: { max: 5, windowMinutes: 60 },
  correction: { max: 10, windowMinutes: 60 },
  login: { max: 10, windowMinutes: 15 },
} as const;
export type RateBucket = keyof typeof RATE_LIMITS;

/**
 * A keyed hash of the client address. With the server secret it cannot be
 * reversed by hashing every possible address.
 */
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/** Records one attempt and says whether it is within the limit. */
export async function checkRateLimit(
  db: Db,
  bucket: RateBucket,
  ipHash: string,
  now = new Date(),
): Promise<boolean> {
  const { max, windowMinutes } = RATE_LIMITS[bucket];
  const since = new Date(now.getTime() - windowMinutes * 60_000);
  const [{ n }] = await db
    .select({ n: count() })
    .from(rateLimits)
    .where(and(eq(rateLimits.bucket, bucket), eq(rateLimits.ipHash, ipHash), gt(rateLimits.createdAt, since)));
  if (n >= max) return false;
  await db.insert(rateLimits).values({ bucket, ipHash, createdAt: now });
  return true;
}

/** Deletes IP hashes and rate-limit rows older than the retention window. */
export async function cleanupPersonalData(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - IP_HASH_RETENTION_DAYS * 86_400_000);
  const s = await db
    .update(submissions)
    .set({ ipHash: null })
    .where(and(isNotNull(submissions.ipHash), lt(submissions.createdAt, cutoff)))
    .returning({ id: submissions.id });
  const c = await db
    .update(corrections)
    .set({ ipHash: null })
    .where(and(isNotNull(corrections.ipHash), lt(corrections.createdAt, cutoff)))
    .returning({ id: corrections.id });
  const r = await db.delete(rateLimits).where(lt(rateLimits.createdAt, cutoff)).returning({ id: rateLimits.id });
  return { submissions: s.length, corrections: c.length, rateLimits: r.length };
}

/** The secret used for IP hashing and admin sessions. */
export function serverSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (at least 16 characters) in production. fix: run `npm run setup` locally, or set it on your host.");
  }
  return "development-only-secret-not-for-production";
}
