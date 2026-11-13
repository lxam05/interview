"use server";

import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { hashIp, serverSecret } from "@/lib/protect";
import { log } from "@/lib/log";
import { submitCorrection, submitReport, type Reflection } from "@/submissions";
import { CANONICAL_TOPICS } from "@/domain/constants";

/*
 * Server actions for the public forms. Next.js checks that server actions
 * come from the same origin; these add the honeypot, timing and rate limits.
 */

async function clientHash() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return hashIp(ip, serverSecret());
}

export type ReportState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Record<string, string>; values: Record<string, string | string[]> }
  | { status: "sent"; reflection: Reflection };

const TOPIC_SLUGS = new Set<string>(CANONICAL_TOPICS.map((t) => t.slug));

export async function sendReport(_prev: ReportState, form: FormData): Promise<ReportState> {
  const values = {
    companyName: String(form.get("companyName") ?? ""),
    roleName: String(form.get("roleName") ?? ""),
    locationName: String(form.get("locationName") ?? ""),
    interviewYear: String(form.get("interviewYear") ?? ""),
    interviewMonth: String(form.get("interviewMonth") ?? ""),
    stage: String(form.get("stage") ?? ""),
    format: String(form.get("format") ?? ""),
    topicSlugs: form.getAll("topicSlugs").map(String).filter((s) => TOPIC_SLUGS.has(s)),
    topics: String(form.get("topics") ?? ""),
    difficulty: String(form.get("difficulty") ?? ""),
    advice: String(form.get("advice") ?? ""),
    comments: String(form.get("comments") ?? ""),
    displayName: String(form.get("displayName") ?? ""),
    idempotencyKey: String(form.get("idempotencyKey") ?? ""),
  };
  const outcome = await submitReport(
    getDb(),
    { ...values, consent: form.get("consent") === "on" },
    {
      honeypot: String(form.get("website") ?? ""),
      startedAt: Number(form.get("startedAt")),
      ipHash: await clientHash(),
    },
  );
  if (outcome.ok) {
    log("submission.received", { id: outcome.id, duplicate: outcome.duplicate });
    return { status: "sent", reflection: outcome.reflection };
  }
  if (outcome.reason === "bot") {
    log("submission.dropped", {
      honeypotFilled: String(form.get("website") ?? "") !== "",
      msSinceLoad: Date.now() - Number(form.get("startedAt")),
    });
    // Look like success so bots learn nothing; nothing was stored.
    return {
      status: "sent",
      reflection: { headline: "Thanks", stage: "", when: "", topics: [], checklist: [] },
    };
  }
  if (outcome.reason === "rate_limited") {
    return {
      status: "error",
      message: "Too many reports from this connection in the last hour. Try again later.",
      fieldErrors: {},
      values,
    };
  }
  return {
    status: "error",
    message: "Some answers need another look. They are marked below.",
    fieldErrors: outcome.fieldErrors ?? {},
    values,
  };
}

export type CorrectionState = { status: "idle" | "sent" } | { status: "error"; message: string; fieldErrors: Record<string, string> };

export async function sendCorrection(_prev: CorrectionState, form: FormData): Promise<CorrectionState> {
  const outcome = await submitCorrection(
    getDb(),
    {
      programmeId: form.get("programmeId") || null,
      kind: String(form.get("kind") ?? "error"),
      message: String(form.get("message") ?? ""),
      contact: String(form.get("contact") ?? ""),
    },
    { honeypot: String(form.get("website") ?? ""), startedAt: 0, ipHash: await clientHash() },
  );
  if (outcome.ok || outcome.reason === "bot") return { status: "sent" };
  if (outcome.reason === "rate_limited") {
    return { status: "error", message: "Too many reports from this connection. Try again in an hour.", fieldErrors: {} };
  }
  return { status: "error", message: "Check the message below.", fieldErrors: outcome.fieldErrors ?? {} };
}
