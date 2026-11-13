import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { publish, reject, saveDraft, unpublish } from "@/actions/admin";
import { getProgramme, getVersion } from "@/admin/queries";
import { briefContentSchema } from "@/briefs/content";
import { AdminScreen, Status, type AdminSearch } from "@/components/admin";
import { Evidence } from "@/components/evidence";
import { hostOf, shortDate } from "@/components/format";
import { getDb } from "@/db/client";
import { INTERVIEW_STAGE_TEXT } from "@/domain/constants";

type Params = Promise<{ id: string }>;

export default function VersionPage({ params, searchParams }: { params: Params; searchParams: AdminSearch }) {
  return (
    <AdminScreen searchParams={searchParams}>
      <Version params={params} />
    </AdminScreen>
  );
}

async function Version({ params }: { params: Params }) {
  const id = Number((await params).id);
  await connection();
  const db = getDb();
  const row = Number.isInteger(id) ? await getVersion(db, id) : null;
  if (!row) notFound();
  const { version, brief, cited } = row;
  const programme = (await getProgramme(db, brief.programmeId))!;
  const content = briefContentSchema.parse(version.content);
  const editable = version.status === "draft";
  const unapproved = cited.filter((c) => c.claim.status !== "approved");
  const claimById = new Map(cited.map((c) => [c.claim.id, c]));

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
      <div className="min-w-0 grid gap-10">
        <header>
          <p className="t-small t-muted">
            <Link href={`/admin/programmes/${programme.id}`}>{programme.companyName}, {programme.role}{programme.location ? `, ${programme.location}` : ""}</Link>
          </p>
          <h1 className="t-h1 mt-1 flex flex-wrap items-baseline gap-x-4">
            Version {version.version} <Status value={version.status} />
          </h1>
          <p className="mt-2 t-small t-muted">
            Built {shortDate(version.createdAt)}
            {version.publishedAt ? `, published ${shortDate(version.publishedAt)}` : ""}. Cites {cited.length} claims.
          </p>
        </header>

        <form action={saveDraft} id="draft" className="grid gap-8">
          <input type="hidden" name="versionId" value={version.id} />
          <input type="hidden" name="rowVersion" value={version.rowVersion} />
          <section>
            <h2 className="t-h2">Topics, in ranked order</h2>
            <p className="t-small t-muted mt-1">Order and labels come from the evidence rules. You can reword the explanation.</p>
            <ol className="mt-4 grid gap-6">
              {content.topics.map((t) => (
                <li key={t.topicSlug} className="border-t border-rule pt-4 grid gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="t-h3">{t.rank}. {t.name}</h3>
                    <Evidence label={t.label} compact />
                  </div>
                  {editable ? (
                    <>
                      <label htmlFor={`why-${t.topicSlug}`} className="sr-only">Why {t.name}</label>
                      <textarea id={`why-${t.topicSlug}`} name={`why:${t.topicSlug}`} defaultValue={t.why} className="input prose-notes min-h-20" />
                    </>
                  ) : (
                    <p className="prose-notes">{t.why}</p>
                  )}
                  <ul className="t-small grid gap-1">
                    {t.claimIds.map((cid) => {
                      const c = claimById.get(cid);
                      return (
                        <li key={cid} className="t-muted">
                          #{cid} {c ? <>{c.claim.statement} <span>({c.source.platform === "community" ? "student report" : hostOf(c.source.canonicalUrl)})</span></> : "missing"}
                          {c && c.claim.status !== "approved" && <span style={{ color: "var(--danger)" }}> no longer approved</span>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="t-h2">Stages</h2>
            <ul className="mt-3 grid gap-3">
              {content.stages.map((s, i) => (
                <li key={i} className="t-small">
                  <span className="font-semibold">{INTERVIEW_STAGE_TEXT[s.stage]}</span>{" "}
                  <span className="t-muted">({s.origin === "official" ? "employer" : "candidates"})</span>: {s.summary}
                </li>
              ))}
            </ul>
          </section>

          <section className="field">
            <h2 className="t-h2"><label htmlFor="limitations">What we don&rsquo;t know</label></h2>
            <p className="hint">One point per line. Shown to every student.</p>
            {editable ? (
              <textarea id="limitations" name="limitations" defaultValue={content.limitations.join("\n")} className="input min-h-32" />
            ) : (
              <ul className="list-disc pl-5">{content.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            )}
          </section>
          {editable && (
            <div>
              <button className="btn btn-quiet" type="submit">Save wording</button>
            </div>
          )}
        </form>
      </div>

      <aside className="lg:sticky lg:top-6 self-start grid gap-6 rounded-md border border-rule bg-raised p-5">
        <h2 className="t-h3">Decision</h2>
        {unapproved.length > 0 && (
          <p className="t-small" style={{ color: "var(--danger)" }}>
            {unapproved.length} cited claims are no longer approved, so this version cannot be published. Build a new draft.
          </p>
        )}
        {editable && (
          <>
            <form action={publish} className="grid gap-3">
              <input type="hidden" name="versionId" value={version.id} />
              <input type="hidden" name="rowVersion" value={version.rowVersion} />
              <div className="field">
                <label htmlFor="note" className="t-small">Note for the log (optional)</label>
                <input id="note" name="note" className="input" />
              </div>
              <button className="btn btn-primary" type="submit" disabled={unapproved.length > 0}>Publish this version</button>
              <p className="t-small t-muted">Save wording changes first. Publishing replaces any version that is live now.</p>
            </form>
            <form action={reject}>
              <input type="hidden" name="versionId" value={version.id} />
              <button className="btn btn-danger w-full" type="submit">Reject draft</button>
            </form>
          </>
        )}
        {version.status === "published" && (
          <>
            <Link href={`/prep/${programme.companySlug}/${programme.slug}`} className="btn btn-quiet">View public page</Link>
            <form action={unpublish} className="grid gap-3">
              <input type="hidden" name="versionId" value={version.id} />
              <div className="field">
                <label htmlFor="unpublish-note" className="t-small">Reason</label>
                <input id="unpublish-note" name="note" className="input" />
              </div>
              <button className="btn btn-danger" type="submit">Unpublish</button>
            </form>
          </>
        )}
        {!editable && version.status !== "published" && (
          <p className="t-small t-muted">This version is {version.status}. Build a new draft to make changes.</p>
        )}
      </aside>
    </div>
  );
}
