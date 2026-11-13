import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { approveDocument, buildDraft, decideClaim, queueResearch } from "@/actions/admin";
import { claimsForReview, getProgramme, versionsFor } from "@/admin/queries";
import { AdminScreen, Status, type AdminSearch } from "@/components/admin";
import { hostOf, shortDate, yearMonth } from "@/components/format";
import { getDb } from "@/db/client";
import { INTERVIEW_STAGE_TEXT, SOURCE_PLATFORM_TEXT } from "@/domain/constants";

type Params = Promise<{ id: string }>;

export default function ProgrammePage({ params, searchParams }: { params: Params; searchParams: AdminSearch }) {
  return (
    <AdminScreen searchParams={searchParams}>
      <Programme params={params} />
    </AdminScreen>
  );
}

async function Programme({ params }: { params: Params }) {
  const id = Number((await params).id);
  await connection();
  const db = getDb();
  const programme = Number.isInteger(id) ? await getProgramme(db, id) : null;
  if (!programme) notFound();
  const [groups, versions] = await Promise.all([claimsForReview(db, id), versionsFor(db, id)]);
  const counts = { extracted: 0, approved: 0, rejected: 0 };
  for (const g of groups) for (const c of g.claims) counts[c.status]++;
  const flagged = versions.find((v) => v.needsReview);

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="t-small t-muted"><Link href="/admin">Internships</Link></p>
          <h1 className="t-h1 mt-1">{programme.companyName}</h1>
          <p className="mt-1 text-ink-soft">
            {programme.role}{programme.location ? `, ${programme.location}` : ""}
            {programme.isSynthetic && <span className="t-muted"> (synthetic, never shown publicly)</span>}
          </p>
          <p className="mt-2 t-small">
            <span className="tabular-nums">{counts.extracted}</span> to review,{" "}
            <span className="tabular-nums">{counts.approved}</span> approved,{" "}
            <span className="tabular-nums">{counts.rejected}</span> rejected
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <form action={queueResearch} className="flex items-end gap-2">
            <input type="hidden" name="programmeId" value={id} />
            <div className="field">
              <label htmlFor="maxCost" className="t-small">Spend limit, USD</label>
              <input id="maxCost" name="maxCost" inputMode="decimal" className="input w-24" placeholder="2.00" />
            </div>
            <button className="btn btn-quiet" type="submit">Run research</button>
          </form>
          <form action={buildDraft}>
            <input type="hidden" name="programmeId" value={id} />
            <button className="btn btn-primary" type="submit" disabled={counts.approved === 0}>
              Build draft from approved claims
            </button>
          </form>
        </div>
      </header>

      {flagged && (
        <p role="alert" className="rounded-md px-4 py-3" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          The published brief needs review: {flagged.needsReviewReason} Build a new draft, or unpublish the current version.
        </p>
      )}

      {versions.length > 0 && (
        <section aria-labelledby="versions">
          <h2 id="versions" className="t-h3">Brief versions</h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                <Link href={`/admin/versions/${v.id}`}>Version {v.version}</Link>
                <Status value={v.status} />
                <span className="t-small t-muted">{shortDate(v.publishedAt ?? v.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="claims" className="grid gap-8">
        <h2 id="claims" className="t-h2">Claims, beside their sources</h2>
        {groups.length === 0 && (
          <p className="t-muted">No claims yet. Run research, or approve a student report for this internship.</p>
        )}
        {groups.map((g) => {
          const pending = g.claims.filter((c) => c.status === "extracted").length;
          return (
            <article key={g.document.id} className="border-t border-rule pt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-semibold">
                    {g.source.platform === "community" ? (
                      g.source.title
                    ) : (
                      <a href={g.source.canonicalUrl} rel="noopener noreferrer nofollow">{g.source.title ?? hostOf(g.source.canonicalUrl)}</a>
                    )}
                  </h3>
                  {pending > 1 && (
                    <form action={approveDocument}>
                      <input type="hidden" name="documentId" value={g.document.id} />
                      <input type="hidden" name="programmeId" value={id} />
                      <button className="btn btn-quiet btn-sm" type="submit">Approve all {pending}</button>
                    </form>
                  )}
                </div>
                <p className="t-small t-muted">
                  {SOURCE_PLATFORM_TEXT[g.source.platform]}, published {shortDate(g.source.publishedAt)}, retrieved {shortDate(g.document.retrievedAt)}
                  {g.document.truncated ? ", truncated for extraction" : ""}
                </p>
                <ul className="mt-4 grid gap-4">
                  {g.claims.map((c) => (
                    <li key={c.id} id={`claim-${c.id}`} className="rounded-md border border-rule bg-raised p-4 scroll-mt-6">
                      <div className="flex flex-wrap items-center justify-between gap-2 t-small">
                        <span className="t-muted">
                          #{c.id}, {c.type.replace("_", " ")}
                          {c.stage ? `, ${INTERVIEW_STAGE_TEXT[c.stage].toLowerCase()}` : ""}
                          {c.topics.length ? `, ${c.topics.join(", ").toLowerCase()}` : ""}
                        </span>
                        <Status value={c.status} />
                      </div>
                      <p className="mt-2 t-small t-muted">
                        {c.roleLevel}, {c.region}, {c.firsthand ? "firsthand" : c.firsthand === false ? "second-hand" : "firsthand unknown"}
                        {yearMonth(c.interviewYear, c.interviewMonth) ? `, interviewed ${yearMonth(c.interviewYear, c.interviewMonth)}` : ""}
                      </p>
                      <p className="quote mt-3"><mark>&ldquo;{c.quote}&rdquo;</mark></p>
                      <form action={decideClaim} className="mt-3 grid gap-2">
                        <input type="hidden" name="claimId" value={c.id} />
                        <label htmlFor={`statement-${c.id}`} className="sr-only">Statement for claim {c.id}</label>
                        <textarea id={`statement-${c.id}`} name="statement" defaultValue={c.statement} className="input min-h-16 t-small" />
                        <div className="flex gap-2">
                          <button name="decision" value="approve" className="btn btn-quiet btn-sm" type="submit">
                            {c.status === "approved" ? "Save" : "Approve"}
                          </button>
                          {c.status !== "rejected" && (
                            <button name="decision" value="reject" className="btn btn-danger btn-sm" type="submit">Reject</button>
                          )}
                        </div>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0">
                <h4 className="sr-only">Source text</h4>
                <SourceText text={g.document.text} quotes={g.claims.map((c) => c.quote)} />
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

/** The stored document as plain text, with each claim's quote highlighted where it appears verbatim. */
function SourceText({ text, quotes }: { text: string; quotes: string[] }) {
  const ranges: [number, number][] = [];
  for (const q of quotes) {
    const at = text.indexOf(q);
    if (at >= 0) ranges.push([at, at + q.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s < pos) continue;
    parts.push(text.slice(pos, s), <mark key={s}>{text.slice(s, e)}</mark>);
    pos = e;
  }
  parts.push(text.slice(pos));
  return (
    <div className="quote whitespace-pre-wrap max-h-[32rem] overflow-y-auto rounded-md border border-rule p-4 text-ink-soft" tabIndex={0} aria-label="Source text">
      {parts}
    </div>
  );
}
