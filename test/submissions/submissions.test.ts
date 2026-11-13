import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, verifySessionToken } from "@/admin/token";
import { approveVersion, synthesiseDraft } from "@/briefs/publish";
import { getPublicBrief } from "@/briefs/public";
import { claims, corrections, rateLimits, submissions } from "@/db/schema";
import { checkRateLimit, cleanupPersonalData, hashIp, RATE_LIMITS } from "@/lib/protect";
import * as store from "@/research/store";
import {
  approveSubmission,
  duplicateHints,
  MIN_FILL_MS,
  reflect,
  rejectSubmission,
  submitCorrection,
  submitReport,
} from "@/submissions";
import { testDb } from "../helpers/db";

const year = new Date().getFullYear();
const now = Date.now();
const guard = (over: Partial<{ honeypot: string; startedAt: number; ipHash: string }> = {}) => ({
  honeypot: "",
  startedAt: now - 60_000,
  ipHash: "ip-a",
  now,
  ...over,
});
const report = (over: Record<string, unknown> = {}) => ({
  companyName: "Test Co",
  roleName: "Software Engineering Intern",
  locationName: "Dublin",
  interviewYear: String(year),
  interviewMonth: "2",
  stage: "online_assessment",
  format: "HackerRank, 90 minutes, two questions",
  topicSlugs: ["data-structures", "algorithms"],
  topics: "A hash map question and a graph traversal (BFS) question.",
  difficulty: "3",
  advice: "Practise timed problems.",
  comments: "",
  displayName: "",
  consent: true,
  idempotencyKey: randomUUID(),
  ...over,
});

describe("submitReport", () => {
  it("stores a valid report as pending and reflects it back", async () => {
    const db = await testDb();
    const out = await submitReport(db, report(), guard());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.reflection.topics).toEqual(["Data structures", "Algorithms"]);
    expect(out.reflection.when).toBe(`February ${year}`);
    const [row] = await db.select().from(submissions);
    expect(row).toMatchObject({ status: "pending", topicSlugs: ["data-structures", "algorithms"], ipHash: "ip-a" });
  });

  it("returns field errors in plain words", async () => {
    const db = await testDb();
    const out = await submitReport(db, report({ topics: "short", consent: false, interviewYear: String(year + 1) }), guard());
    expect(out).toMatchObject({ ok: false, reason: "invalid" });
    if (out.ok) return;
    expect(Object.keys(out.fieldErrors!)).toEqual(expect.arrayContaining(["topics", "consent", "interviewYear"]));
    expect(await db.select().from(submissions)).toHaveLength(0);
  });

  it("drops bots silently: honeypot filled or posted too fast", async () => {
    const db = await testDb();
    expect(await submitReport(db, report(), guard({ honeypot: "http://spam" }))).toMatchObject({ reason: "bot" });
    expect(await submitReport(db, report(), guard({ startedAt: now - MIN_FILL_MS + 500 }))).toMatchObject({ reason: "bot" });
    expect(await db.select().from(submissions)).toHaveLength(0);
  });

  it("is idempotent on the client key", async () => {
    const db = await testDb();
    const body = report();
    const a = await submitReport(db, body, guard());
    const b = await submitReport(db, body, guard());
    expect(b).toMatchObject({ ok: true, duplicate: true });
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
    expect(await db.select().from(submissions)).toHaveLength(1);
  });

  it("rate limits per hashed address", async () => {
    const db = await testDb();
    for (let i = 0; i < RATE_LIMITS.submission.max; i++) {
      expect((await submitReport(db, report(), guard())).ok).toBe(true);
    }
    expect(await submitReport(db, report(), guard())).toMatchObject({ reason: "rate_limited" });
    expect((await submitReport(db, report(), guard({ ipHash: "ip-b" }))).ok).toBe(true);
  });
});

describe("moderation", () => {
  it("an approved report becomes approved, traceable evidence in the next draft", async () => {
    const db = await testDb();
    const company = await store.upsertCompany(db, { name: "Test Co" });
    const programme = await store.ensureProgramme(db, { companyId: company.id, locationSlug: "dublin" });
    const out = await submitReport(db, report(), guard());
    if (!out.ok) throw new Error("submit failed");

    const result = await approveSubmission(db, { submissionId: out.id, programmeId: programme.id });
    expect(result.claims).toBe(4); // format + two topics + advice
    const again = await approveSubmission(db, { submissionId: out.id, programmeId: programme.id });
    expect(again.claims).toBe(0);

    const stored = await db.select().from(claims).where(eq(claims.programmeId, programme.id));
    expect(stored.every((c) => c.status === "approved" && c.region === "ireland" && c.firsthand)).toBe(true);

    const draft = await synthesiseDraft(db, programme.id);
    expect(draft.content.topics.map((t) => t.topicSlug)).toEqual(expect.arrayContaining(["data-structures", "algorithms"]));
    await approveVersion(db, { versionId: draft.id, rowVersion: draft.rowVersion });
    const brief = await getPublicBrief(db, "test-co", programme.slug);
    const cited = [...brief!.claims.values()];
    expect(cited.length).toBeGreaterThan(0);
    // Student reports are cited without a link to the raw submission.
    expect(cited.every((c) => c.source.platform === "community" && c.source.url === "")).toBe(true);
  });

  it("rejected reports never become evidence; duplicates are hinted", async () => {
    const db = await testDb();
    const a = await submitReport(db, report(), guard());
    const b = await submitReport(db, report({ companyName: "test co." }), guard());
    if (!a.ok || !b.ok) throw new Error("submit failed");
    expect((await duplicateHints(db, b.id)).map((h) => h.id)).toEqual([a.id]);
    await rejectSubmission(db, a.id, "spam");
    expect(await db.select().from(claims)).toHaveLength(0);
  });
});

describe("corrections", () => {
  it("stores an error report against a programme", async () => {
    const db = await testDb();
    const company = await store.upsertCompany(db, { name: "Test Co" });
    const programme = await store.ensureProgramme(db, { companyId: company.id, locationSlug: "dublin" });
    const out = await submitCorrection(db, { programmeId: programme.id, kind: "error", message: "The OA was 60 minutes, not 90." }, guard());
    expect(out.ok).toBe(true);
    const [row] = await db.select().from(corrections);
    expect(row).toMatchObject({ programmeId: programme.id, status: "open" });
    expect(await submitCorrection(db, { kind: "error", message: "short" }, guard())).toMatchObject({ reason: "invalid" });
  });
});

describe("privacy and protection", () => {
  it("IP hashes are keyed and deleted after 30 days", async () => {
    expect(hashIp("1.2.3.4", "secret-one-123456")).not.toBe(hashIp("1.2.3.4", "secret-two-123456"));
    expect(hashIp("1.2.3.4", "k".repeat(16))).toHaveLength(32);

    const db = await testDb();
    const out = await submitReport(db, report(), guard());
    if (!out.ok) throw new Error();
    const old = new Date(Date.now() - 31 * 86_400_000);
    await db.update(submissions).set({ createdAt: old });
    await checkRateLimit(db, "login", "ip-a", old);
    const cleaned = await cleanupPersonalData(db);
    expect(cleaned.submissions).toBe(1);
    expect(cleaned.rateLimits).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(submissions);
    expect(row.ipHash).toBeNull();
    expect((await db.select().from(rateLimits)).every((r) => r.createdAt > old)).toBe(true);
  });

  it("reflection lists picked topics and the format", () => {
    const r = reflect({ companyName: "X", stage: "phone_screen", interviewYear: 2026, interviewMonth: null, topicSlugs: ["behavioural", "other"], advice: "", format: "30 min call." });
    expect(r).toMatchObject({ headline: "Phone or recruiter screen at X", when: "2026", topics: ["Behavioural questions"] });
    expect(r.checklist.at(-1)).toBe("Format to expect: 30 min call.");
  });
});

describe("admin session tokens", () => {
  const secret = "s".repeat(32);
  it("verifies its own tokens and rejects forged, expired or foreign ones", () => {
    const { token } = createSessionToken(secret, 1_000);
    expect(verifySessionToken(token, secret, 2_000)).toBe(true);
    expect(verifySessionToken(token, secret, 1_000 + 13 * 3_600_000)).toBe(false);
    expect(verifySessionToken(token, "x".repeat(32), 2_000)).toBe(false);
    const [exp, mac] = token.split(".");
    expect(verifySessionToken(`${Number(exp) + 1}.${mac}`, secret, 2_000)).toBe(false);
    expect(verifySessionToken(undefined, secret)).toBe(false);
    expect(verifySessionToken("garbage", secret)).toBe(false);
  });

  it("an unset admin password never matches", () => {
    expect(passwordMatches("", undefined)).toBe(false);
    expect(passwordMatches("", "")).toBe(false);
    expect(passwordMatches("right", "right")).toBe(true);
    expect(passwordMatches("wrong", "right")).toBe(false);
  });
});
