import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  briefs,
  briefVersionClaims,
  briefVersions,
  claims,
  programmes,
  reviews,
} from "@/db/schema";
import * as store from "@/research/store";
import { buildBriefContent } from "@/research/synthesise";
import { briefContentSchema, type BriefContent } from "./content";

/*
 * The only module that changes a brief version's status.
 *
 *   draft ──approve──> published ──unpublish──> unpublished
 *     └────reject───> rejected
 *
 * Approving re-checks, inside one transaction, that the version has not
 * changed since the reviewer loaded it and that every claim it cites is still
 * approved. Synthesis always writes a new draft; nothing is published without
 * a person approving it.
 */

export type PublishProblem = "stale" | "not_draft" | "claims_not_approved" | "not_found" | "no_claims";

export class PublishError extends Error {
  constructor(
    readonly problem: PublishProblem,
    message: string,
  ) {
    super(message);
  }
}

async function audit(db: Pick<Db, "insert">, entityType: string, entityId: number, action: string, note?: string | null) {
  await db.insert(reviews).values({ entityType, entityId, action, note: note ?? null });
}

/** Build a new draft from the programme's approved claims. */
export async function synthesiseDraft(db: Db, programmeId: number, now = new Date()) {
  const [programme] = await db.select().from(programmes).where(eq(programmes.id, programmeId));
  if (!programme) throw new PublishError("not_found", `Programme ${programmeId} does not exist.`);
  const evidence = await store.loadEvidenceClaims(db, programmeId, ["approved"]);
  if (!evidence.length) {
    throw new PublishError(
      "no_claims",
      "No approved claims for this programme yet. Approve at least one claim, then build the draft.",
    );
  }
  const catalogue = await store.loadTopicCatalogue(db);
  const content = buildBriefContent({ claims: evidence, ...catalogue, now });
  const result = await store.createDraftVersion(db, {
    programmeId,
    content,
    isSynthetic: programme.isSynthetic,
  });
  await audit(db, "brief_version", result.version.id, "draft_created");
  return result.version;
}

/** Reviewer edits to a draft's wording. Claims, labels and order cannot change here. */
export async function editDraftText(
  db: Db,
  input: {
    versionId: number;
    rowVersion: number;
    why: Record<string, string>;
    limitations: string[];
  },
) {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.id, input.versionId))
      .for("update");
    if (!version) throw new PublishError("not_found", "That version no longer exists.");
    if (version.status !== "draft") throw new PublishError("not_draft", "Only drafts can be edited.");
    if (version.rowVersion !== input.rowVersion) {
      throw new PublishError("stale", "Someone changed this draft after you opened it. Reload and try again.");
    }
    const content: BriefContent = briefContentSchema.parse({
      ...version.content,
      topics: version.content.topics.map((t) => ({
        ...t,
        why: input.why[t.topicSlug]?.trim() || t.why,
      })),
      limitations: input.limitations.map((l) => l.trim()).filter(Boolean),
    });
    await tx
      .update(briefVersions)
      .set({ content, rowVersion: version.rowVersion + 1 })
      .where(eq(briefVersions.id, version.id));
    await audit(tx, "brief_version", version.id, "edited");
    return version.rowVersion + 1;
  });
}

/** Publish a draft. Replaces any currently published version of the same brief. */
export async function approveVersion(
  db: Db,
  input: { versionId: number; rowVersion: number; note?: string | null; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.id, input.versionId))
      .for("update");
    if (!version) throw new PublishError("not_found", "That version no longer exists.");
    if (version.status !== "draft" && version.status !== "in_review") {
      throw new PublishError("not_draft", `This version is ${version.status}; only drafts can be approved.`);
    }
    if (version.rowVersion !== input.rowVersion) {
      throw new PublishError("stale", "This draft changed after you opened it. Reload, check it, and approve again.");
    }
    const cited = await tx
      .select({ id: claims.id, status: claims.status })
      .from(briefVersionClaims)
      .innerJoin(claims, eq(claims.id, briefVersionClaims.claimId))
      .where(eq(briefVersionClaims.versionId, version.id))
      .for("update", { of: claims });
    const unapproved = cited.filter((c) => c.status !== "approved").map((c) => c.id);
    if (unapproved.length) {
      throw new PublishError(
        "claims_not_approved",
        `Claims ${unapproved.join(", ")} are no longer approved. Build a new draft from the current claims.`,
      );
    }

    await tx
      .update(briefVersions)
      .set({ status: "unpublished", reviewedAt: now })
      .where(and(eq(briefVersions.briefId, version.briefId), eq(briefVersions.status, "published")));
    await tx
      .update(briefVersions)
      .set({
        status: "published",
        publishedAt: now,
        reviewedAt: now,
        reviewerNote: input.note ?? null,
        rowVersion: version.rowVersion + 1,
      })
      .where(eq(briefVersions.id, version.id));
    await tx
      .update(briefs)
      .set({ needsReview: false, needsReviewReason: null })
      .where(eq(briefs.id, version.briefId));
    await audit(tx, "brief_version", version.id, "published", input.note);
    const [brief] = await tx.select().from(briefs).where(eq(briefs.id, version.briefId));
    return { briefId: brief.id, programmeId: brief.programmeId };
  });
}

/** Take a published version down. The brief page falls back to the no-brief state. */
export async function unpublishVersion(db: Db, versionId: number, note?: string | null) {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.id, versionId))
      .for("update");
    if (!version) throw new PublishError("not_found", "That version no longer exists.");
    if (version.status !== "published") {
      throw new PublishError("not_draft", "Only the published version can be unpublished.");
    }
    await tx
      .update(briefVersions)
      .set({ status: "unpublished", reviewedAt: new Date(), rowVersion: version.rowVersion + 1 })
      .where(eq(briefVersions.id, versionId));
    await audit(tx, "brief_version", versionId, "unpublished", note);
    const [brief] = await tx.select().from(briefs).where(eq(briefs.id, version.briefId));
    return { briefId: brief.id, programmeId: brief.programmeId };
  });
}

export async function rejectVersion(db: Db, versionId: number, note?: string | null) {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.id, versionId))
      .for("update");
    if (!version) throw new PublishError("not_found", "That version no longer exists.");
    if (version.status !== "draft" && version.status !== "in_review") {
      throw new PublishError("not_draft", "Only drafts can be rejected.");
    }
    await tx
      .update(briefVersions)
      .set({ status: "rejected", reviewedAt: new Date(), reviewerNote: note ?? null })
      .where(eq(briefVersions.id, versionId));
    await audit(tx, "brief_version", versionId, "rejected", note);
  });
}

/**
 * Approve or reject one claim. Rejecting a claim that a published version
 * cites flags that brief for review; it stays up until a person decides.
 */
export async function reviewClaim(
  db: Db,
  input: { claimId: number; decision: "approve" | "reject"; statement?: string | null; note?: string | null },
) {
  return db.transaction(async (tx) => {
    const [claim] = await tx.select().from(claims).where(eq(claims.id, input.claimId)).for("update");
    if (!claim) throw new PublishError("not_found", `Claim ${input.claimId} does not exist.`);
    const statement = input.statement?.trim();
    await tx
      .update(claims)
      .set({
        status: input.decision === "approve" ? "approved" : "rejected",
        statement: statement || claim.statement,
        reviewedAt: new Date(),
      })
      .where(eq(claims.id, claim.id));
    await audit(
      tx,
      "claim",
      claim.id,
      input.decision === "approve" ? (statement && statement !== claim.statement ? "approved_edited" : "approved") : "rejected",
      input.note,
    );

    let flagged: number[] = [];
    if (input.decision === "reject") {
      const affected = await tx
        .selectDistinct({ briefId: briefVersions.briefId })
        .from(briefVersionClaims)
        .innerJoin(briefVersions, eq(briefVersions.id, briefVersionClaims.versionId))
        .where(and(eq(briefVersionClaims.claimId, claim.id), eq(briefVersions.status, "published")));
      flagged = affected.map((a) => a.briefId);
      if (flagged.length) {
        await tx
          .update(briefs)
          .set({ needsReview: true, needsReviewReason: `Claim ${claim.id} was rejected after publishing.` })
          .where(inArray(briefs.id, flagged));
      }
    }
    return { flaggedBriefIds: flagged, programmeId: claim.programmeId };
  });
}

/** Approve every unreviewed claim of one document at once (reviewer shortcut). */
export async function approveDocumentClaims(db: Db, sourceDocumentId: number, programmeId: number) {
  const updated = await db
    .update(claims)
    .set({ status: "approved", reviewedAt: new Date() })
    .where(
      and(
        eq(claims.sourceDocumentId, sourceDocumentId),
        eq(claims.programmeId, programmeId),
        eq(claims.status, "extracted"),
      ),
    )
    .returning({ id: claims.id });
  for (const u of updated) await audit(db, "claim", u.id, "approved");
  return updated.length;
}
