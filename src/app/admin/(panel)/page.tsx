import Link from "next/link";
import { connection } from "next/server";
import { addProgramme } from "@/actions/admin";
import { listProgrammes, overview } from "@/admin/queries";
import { AdminScreen, type AdminSearch } from "@/components/admin";
import { getDb } from "@/db/client";
import { listLocations } from "@/briefs/public";

export default function AdminHome({ searchParams }: { searchParams: AdminSearch }) {
  return (
    <AdminScreen searchParams={searchParams}>
      <Overview />
    </AdminScreen>
  );
}

async function Overview() {
  await connection();
  const db = getDb();
  const [o, programmes, locations] = await Promise.all([overview(db), listProgrammes(db), listLocations(db)]);
  const todo = [
    { n: o.pendingClaims, text: "claims to review", href: programmes.find((p) => p.claims.extracted > 0) ? `/admin/programmes/${programmes.find((p) => p.claims.extracted > 0)!.id}` : null },
    { n: o.drafts, text: "draft briefs waiting for a decision", href: null },
    { n: o.flaggedBriefs, text: "published briefs flagged for review", href: null },
    { n: o.pendingSubmissions, text: "student reports to moderate", href: "/admin/submissions" },
    { n: o.openCorrections, text: "error reports open", href: "/admin/corrections" },
    { n: o.activeRuns, text: "research runs queued or running", href: "/admin/runs" },
  ];

  return (
    <div className="grid gap-12">
      <section aria-labelledby="todo">
        <h1 id="todo" className="t-h1">Waiting for you</h1>
        <ul className="mt-6 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3 border-t border-rule">
          {todo.map((t) => (
            <li key={t.text} className="border-b border-rule py-4 flex items-baseline gap-3">
              <span className={`t-h2 tabular-nums ${t.n ? "" : "text-muted"}`}>{t.n}</span>
              {t.href && t.n ? <Link href={t.href}>{t.text}</Link> : <span className={t.n ? "" : "t-muted"}>{t.text}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 t-small t-muted">Model and search spend in the last 30 days: ${o.spend30dUsd.toFixed(2)}</p>
      </section>

      <section aria-labelledby="programmes">
        <h2 id="programmes" className="t-h2">Internships</h2>
        {programmes.length === 0 ? (
          <p className="mt-3 t-muted">None yet. Add the first one below.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left t-small">
              <thead className="t-muted">
                <tr className="border-b border-rule">
                  <th className="py-2 pr-4 font-medium">Company</th>
                  <th className="py-2 pr-4 font-medium">Internship</th>
                  <th className="py-2 pr-4 font-medium">Claims to review</th>
                  <th className="py-2 pr-4 font-medium">Approved</th>
                  <th className="py-2 pr-4 font-medium">Public brief</th>
                </tr>
              </thead>
              <tbody>
                {programmes.map((p) => (
                  <tr key={p.id} className="border-b border-rule">
                    <td className="py-3 pr-4">
                      <Link href={`/admin/programmes/${p.id}`} className="font-medium">{p.companyName}</Link>
                      {p.isSynthetic && <span className="ml-2 t-muted">(synthetic)</span>}
                    </td>
                    <td className="py-3 pr-4">{p.role}{p.location ? `, ${p.location}` : ""}</td>
                    <td className="py-3 pr-4 tabular-nums">{p.claims.extracted || <span className="t-muted">0</span>}</td>
                    <td className="py-3 pr-4 tabular-nums">{p.claims.approved}</td>
                    <td className="py-3 pr-4">
                      {p.needsReview ? (
                        <span style={{ color: "var(--danger)" }}>Needs review</span>
                      ) : p.published ? (
                        <span style={{ color: "var(--strong)" }}>Published</span>
                      ) : p.drafts ? (
                        "Draft waiting"
                      ) : (
                        <span className="t-muted">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="add" className="max-w-2xl">
        <h2 id="add" className="t-h2">Add an internship</h2>
        <form action={addProgramme} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="company">Company</label>
            <input id="company" name="company" className="input" required />
          </div>
          <div className="field">
            <label htmlFor="location">Location</label>
            <select id="location" name="location" className="input" defaultValue="dublin">
              {locations.map((l) => (
                <option key={l.slug} value={l.slug}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="aliases">Other names, comma separated</label>
            <input id="aliases" name="aliases" className="input" />
          </div>
          <div className="field">
            <label htmlFor="website">Careers page</label>
            <input id="website" name="website" type="url" className="input" placeholder="https://" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn btn-primary" type="submit">Add internship</button>
          </div>
        </form>
      </section>
    </div>
  );
}
