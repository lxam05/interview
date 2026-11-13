import Link from "next/link";
import { connection } from "next/server";
import { moderateSubmission } from "@/actions/admin";
import { listProgrammes, listSubmissions } from "@/admin/queries";
import { AdminScreen, Status, type AdminSearch } from "@/components/admin";
import { shortDate, yearMonth } from "@/components/format";
import { getDb } from "@/db/client";
import { CANONICAL_TOPICS, INTERVIEW_STAGE_TEXT } from "@/domain/constants";
import { duplicateHints } from "@/submissions";
import { nameKey } from "@/research/dedupe";

const STATUSES = ["pending", "approved", "rejected"] as const;

export default function SubmissionsPage({ searchParams }: { searchParams: AdminSearch }) {
  return (
    <AdminScreen searchParams={searchParams}>
      <Submissions searchParams={searchParams} />
    </AdminScreen>
  );
}

async function Submissions({ searchParams }: { searchParams: AdminSearch }) {
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? "pending";
  await connection();
  const db = getDb();
  const [rows, programmes] = await Promise.all([listSubmissions(db, status), listProgrammes(db)]);
  const hints = new Map(await Promise.all(rows.map(async (r) => [r.id, await duplicateHints(db, r.id)] as const)));
  const topicName = new Map<string, string>(CANONICAL_TOPICS.map((t) => [t.slug, t.name]));
  const real = programmes.filter((p) => !p.isSynthetic);

  return (
    <div className="max-w-4xl">
      <h1 className="t-h1">Student reports</h1>
      <p className="mt-2 t-muted max-w-[64ch]">
        Check it reads as a real interview, remove names of other people, and match it to an
        internship. Approved reports become firsthand evidence for that internship&rsquo;s next draft.
      </p>
      <nav aria-label="Filter" className="mt-5 flex gap-4 t-small">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/submissions?status=${s}`} aria-current={s === status ? "page" : undefined} className={s === status ? "font-semibold" : "t-muted"}>
            {s[0].toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="mt-8 t-muted">No {status} reports.</p>
      ) : (
        <ul className="mt-6 grid gap-8">
          {rows.map((s) => {
            const guess = real.find((p) => nameKey(p.companyName) === nameKey(s.companyName));
            const dupes = hints.get(s.id) ?? [];
            return (
              <li key={s.id} className="border-t border-rule pt-6 grid gap-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="t-h3">
                    {s.companyName}: {INTERVIEW_STAGE_TEXT[s.stage]}
                  </h2>
                  <Status value={s.status} />
                </div>
                <p className="t-small t-muted">
                  #{s.id}. {s.roleName}, {s.locationName}, interviewed {yearMonth(s.interviewYear, s.interviewMonth)}. Sent{" "}
                  {shortDate(s.createdAt)}{s.displayName ? ` by ${s.displayName}` : ", anonymous"}
                  {s.difficulty ? `. Difficulty ${s.difficulty} of 5` : ""}.
                </p>
                {dupes.length > 0 && (
                  <p className="t-small" style={{ color: "var(--caution)" }}>
                    Possible duplicate of {dupes.map((d) => `#${d.id} (${d.status})`).join(", ")}: same company, stage and year.
                  </p>
                )}
                <dl className="prose-notes grid gap-2 max-w-none">
                  <div><dt className="inline font-semibold text-ink">Format: </dt><dd className="inline">{s.format}</dd></div>
                  {s.topicSlugs.length > 0 && (
                    <div><dt className="inline font-semibold text-ink">Topics: </dt><dd className="inline">{s.topicSlugs.map((t) => topicName.get(t) ?? t).join(", ")}</dd></div>
                  )}
                  <div><dt className="inline font-semibold text-ink">What came up: </dt><dd className="inline whitespace-pre-wrap">{s.topics}</dd></div>
                  {s.advice && <div><dt className="inline font-semibold text-ink">Advice: </dt><dd className="inline">{s.advice}</dd></div>}
                  {s.comments && <div><dt className="inline font-semibold text-ink">Comments: </dt><dd className="inline">{s.comments}</dd></div>}
                </dl>
                {s.status === "pending" && (
                  <form action={moderateSubmission} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="submissionId" value={s.id} />
                    <div className="field">
                      <label htmlFor={`programme-${s.id}`} className="t-small">Internship it is about</label>
                      <select id={`programme-${s.id}`} name="programmeId" className="input min-w-64" defaultValue={guess?.id ?? ""}>
                        <option value="">Choose one</option>
                        {real.map((p) => (
                          <option key={p.id} value={p.id}>{p.companyName}, {p.role}{p.location ? `, ${p.location}` : ""}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`note-${s.id}`} className="t-small">Note (optional)</label>
                      <input id={`note-${s.id}`} name="note" className="input" />
                    </div>
                    <button name="decision" value="approve" className="btn btn-primary" type="submit">Approve as evidence</button>
                    <button name="decision" value="reject" className="btn btn-danger" type="submit">Reject</button>
                  </form>
                )}
                {s.status === "pending" && !guess && (
                  <p className="t-small t-muted">No internship matches this company yet. <Link href="/admin#add">Add it</Link> first.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
