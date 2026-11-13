import Link from "next/link";
import { connection } from "next/server";
import { closeCorrection } from "@/actions/admin";
import { listCorrections } from "@/admin/queries";
import { AdminScreen, Status, type AdminSearch } from "@/components/admin";
import { shortDate } from "@/components/format";
import { getDb } from "@/db/client";

const KIND_TEXT = { error: "Something is wrong", outdated: "Out of date", removal_request: "Removal request" } as const;
const STATUSES = ["open", "resolved", "dismissed"] as const;

export default function CorrectionsPage({ searchParams }: { searchParams: AdminSearch }) {
  return (
    <AdminScreen searchParams={searchParams}>
      <Corrections searchParams={searchParams} />
    </AdminScreen>
  );
}

async function Corrections({ searchParams }: { searchParams: AdminSearch }) {
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? "open";
  await connection();
  const rows = await listCorrections(getDb(), status);
  return (
    <div className="max-w-4xl">
      <h1 className="t-h1">Error reports</h1>
      <p className="mt-2 t-muted max-w-[64ch]">
        Removal requests come first: act on them within a few days. To fix a brief, reject the claim
        behind it and publish a new draft.
      </p>
      <nav aria-label="Filter" className="mt-5 flex gap-4 t-small">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/corrections?status=${s}`} aria-current={s === status ? "page" : undefined} className={s === status ? "font-semibold" : "t-muted"}>
            {s[0].toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="mt-8 t-muted">No {status} reports.</p>
      ) : (
        <ul className="mt-6 grid gap-6">
          {[...rows]
            .sort((a, b) => Number(b.correction.kind === "removal_request") - Number(a.correction.kind === "removal_request"))
            .map(({ correction: c, companyName, companySlug, programmeSlug }) => (
              <li key={c.id} className="border-t border-rule pt-5 grid gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-semibold" style={c.kind === "removal_request" ? { color: "var(--danger)" } : undefined}>
                    {KIND_TEXT[c.kind]}
                    {companyName ? (
                      <>
                        {" "}on <Link href={`/prep/${companySlug}/${programmeSlug}`}>{companyName}</Link>
                      </>
                    ) : null}
                  </h2>
                  <Status value={c.status} />
                </div>
                <p className="prose-notes whitespace-pre-wrap max-w-none">{c.message}</p>
                <p className="t-small t-muted">
                  #{c.id}, sent {shortDate(c.createdAt)}{c.contact ? `. Reply to ${c.contact}` : ". No contact given"}.
                </p>
                {c.status === "open" && (
                  <form action={closeCorrection} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="correctionId" value={c.id} />
                    <div className="field">
                      <label htmlFor={`cnote-${c.id}`} className="t-small">What you did</label>
                      <input id={`cnote-${c.id}`} name="note" className="input min-w-72" />
                    </div>
                    <button name="status" value="resolved" className="btn btn-primary" type="submit">Mark resolved</button>
                    <button name="status" value="dismissed" className="btn btn-quiet" type="submit">Dismiss</button>
                  </form>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
