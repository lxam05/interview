"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { endSession, requireAdmin, startSession } from "@/admin/session";
import { passwordMatches } from "@/admin/token";
import { PUBLIC_TAG } from "@/briefs/read";
import {
  approveDocumentClaims,
  approveVersion,
  editDraftText,
  PublishError,
  rejectVersion,
  reviewClaim,
  synthesiseDraft,
  unpublishVersion,
} from "@/briefs/publish";
import { getDb } from "@/db/client";
import { checkRateLimit, hashIp, serverSecret } from "@/lib/protect";
import { log } from "@/lib/log";
import { ResearchError } from "@/research/errors";
import * as store from "@/research/store";
import { approveSubmission, rejectSubmission, resolveCorrection } from "@/submissions";

/*
 * Every admin action starts with requireAdmin(). Next.js rejects server
 * actions posted from another origin. Outcomes are reported back with a
 * redirect carrying ?done= or ?error=, so every screen works without
 * client-side state.
 */

const int = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Missing or invalid id.");
  return n;
};
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function back(path: string, outcome: { done?: string; error?: string }): never {
  const q = new URLSearchParams(outcome as Record<string, string>).toString();
  redirect(`${path}${path.includes("?") ? "&" : "?"}${q}`);
}

function message(err: unknown): string {
  if (err instanceof PublishError) return err.message;
  if (err instanceof ResearchError) return `${err.message} (${err.code})`;
  throw err;
}

// ── Session ─────────────────────────────────────────────────────────────────

export async function login(form: FormData) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimit(getDb(), "login", hashIp(ip, serverSecret())))) {
    redirect("/admin/login?error=Too+many+attempts.+Wait+15+minutes+and+try+again.");
  }
  if (!process.env.ADMIN_PASSWORD) {
    redirect("/admin/login?error=ADMIN_PASSWORD+is+not+set+on+the+server.+Run+npm+run+setup.");
  }
  if (!passwordMatches(str(form.get("password")), process.env.ADMIN_PASSWORD)) {
    log("admin.login_failed");
    redirect("/admin/login?error=That+password+is+not+right.");
  }
  await startSession();
  redirect("/admin");
}

export async function logout() {
  await endSession();
  redirect("/admin/login");
}

// ── Companies and research ──────────────────────────────────────────────────

export async function addProgramme(form: FormData) {
  await requireAdmin();
  const name = str(form.get("company"));
  if (name.length < 2) back("/admin", { error: "Enter a company name." });
  const db = getDb();
  const company = await store.upsertCompany(db, {
    name,
    aliases: str(form.get("aliases")).split(",").map((a) => a.trim()).filter(Boolean),
    website: str(form.get("website")) || null,
  });
  const programme = await store.ensureProgramme(db, {
    companyId: company.id,
    locationSlug: str(form.get("location")) || null,
  });
  updateTag(PUBLIC_TAG);
  back(`/admin/programmes/${programme.id}`, { done: `${company.name} is set up.` });
}

export async function queueResearch(form: FormData) {
  await requireAdmin();
  const programmeId = int(form.get("programmeId"));
  const maxCost = Number(str(form.get("maxCost")) || "NaN");
  let runId: number;
  try {
    const run = await store.queueRun(getDb(), {
      programmeId,
      requestedBy: "admin",
      maxCostUsd: Number.isFinite(maxCost) && maxCost > 0 ? maxCost : null,
    });
    runId = run.id;
  } catch (err) {
    back(`/admin/programmes/${programmeId}`, { error: message(err) });
  }
  back(`/admin/runs/${runId}`, { done: "Research queued. The worker (npm run research:worker) picks it up." });
}

// ── Claims ──────────────────────────────────────────────────────────────────

export async function decideClaim(form: FormData) {
  await requireAdmin();
  const claimId = int(form.get("claimId"));
  const decision = str(form.get("decision")) === "reject" ? "reject" : "approve";
  const result = await reviewClaim(getDb(), {
    claimId,
    decision,
    statement: str(form.get("statement")) || null,
  });
  const flagged = result.flaggedBriefIds.length
    ? " A published brief cites it and is now flagged for review."
    : "";
  back(`/admin/programmes/${result.programmeId}#claim-${claimId}`, {
    done: `Claim ${claimId} ${decision === "approve" ? "approved" : "rejected"}.${flagged}`,
  });
}

export async function approveDocument(form: FormData) {
  await requireAdmin();
  const programmeId = int(form.get("programmeId"));
  const n = await approveDocumentClaims(getDb(), int(form.get("documentId")), programmeId);
  back(`/admin/programmes/${programmeId}`, { done: `${n} claims approved.` });
}

// ── Briefs ──────────────────────────────────────────────────────────────────

export async function buildDraft(form: FormData) {
  await requireAdmin();
  const programmeId = int(form.get("programmeId"));
  let versionId: number;
  try {
    versionId = (await synthesiseDraft(getDb(), programmeId)).id;
  } catch (err) {
    back(`/admin/programmes/${programmeId}`, { error: message(err) });
  }
  back(`/admin/versions/${versionId}`, { done: "Draft built from the approved claims. Read it, then approve or reject it." });
}

export async function saveDraft(form: FormData) {
  await requireAdmin();
  const versionId = int(form.get("versionId"));
  const why: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("why:")) why[k.slice(4)] = String(v);
  try {
    await editDraftText(getDb(), {
      versionId,
      rowVersion: int(form.get("rowVersion")),
      why,
      limitations: str(form.get("limitations")).split("\n"),
    });
  } catch (err) {
    back(`/admin/versions/${versionId}`, { error: message(err) });
  }
  back(`/admin/versions/${versionId}`, { done: "Draft saved." });
}

export async function publish(form: FormData) {
  await requireAdmin();
  const versionId = int(form.get("versionId"));
  try {
    await approveVersion(getDb(), {
      versionId,
      rowVersion: int(form.get("rowVersion")),
      note: str(form.get("note")) || null,
    });
  } catch (err) {
    back(`/admin/versions/${versionId}`, { error: message(err) });
  }
  updateTag(PUBLIC_TAG);
  back(`/admin/versions/${versionId}`, { done: "Published. The public page shows this version now." });
}

export async function unpublish(form: FormData) {
  await requireAdmin();
  const versionId = int(form.get("versionId"));
  try {
    await unpublishVersion(getDb(), versionId, str(form.get("note")) || null);
  } catch (err) {
    back(`/admin/versions/${versionId}`, { error: message(err) });
  }
  updateTag(PUBLIC_TAG);
  back(`/admin/versions/${versionId}`, { done: "Unpublished. The public page shows the no-brief state." });
}

export async function reject(form: FormData) {
  await requireAdmin();
  const versionId = int(form.get("versionId"));
  try {
    await rejectVersion(getDb(), versionId, str(form.get("note")) || null);
  } catch (err) {
    back(`/admin/versions/${versionId}`, { error: message(err) });
  }
  back(`/admin/versions/${versionId}`, { done: "Draft rejected." });
}

// ── Community ───────────────────────────────────────────────────────────────

export async function moderateSubmission(form: FormData) {
  await requireAdmin();
  const submissionId = int(form.get("submissionId"));
  const note = str(form.get("note")) || null;
  if (str(form.get("decision")) === "reject") {
    await rejectSubmission(getDb(), submissionId, note);
    back("/admin/submissions", { done: `Report ${submissionId} rejected.` });
  }
  const programmeId = Number(form.get("programmeId"));
  if (!programmeId) back("/admin/submissions", { error: "Choose which internship the report is about first." });
  const result = await approveSubmission(getDb(), { submissionId, programmeId, note });
  back("/admin/submissions", {
    done: `Report ${submissionId} approved as ${result.claims} claims. Build a new draft for that internship to include it.`,
  });
}

export async function closeCorrection(form: FormData) {
  await requireAdmin();
  const id = int(form.get("correctionId"));
  const status = str(form.get("status")) === "dismissed" ? "dismissed" : "resolved";
  await resolveCorrection(getDb(), id, status, str(form.get("note")) || null);
  back("/admin/corrections", { done: `Report ${id} ${status}.` });
}
