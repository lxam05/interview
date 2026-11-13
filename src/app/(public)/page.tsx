import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { readLocations, readPublished, readSearch } from "@/briefs/read";
import { Evidence } from "@/components/evidence";
import { shortDate } from "@/components/format";

type Search = Promise<{ q?: string; location?: string }>;

export default function Home({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 sm:pt-24 pb-12">
        <Form action="/" className="max-w-[22ch] sm:max-w-none" role="search" aria-label="Find a company">
          <h1 className="t-display max-w-[18ch]">
            <label htmlFor="q">What should I study for my</label>{" "}
            <Suspense fallback={<input id="q" name="q" className="blank" placeholder="company" autoComplete="off" />}>
              <QueryBlank searchParams={searchParams} />
            </Suspense>{" "}
            internship interview?
          </h1>
          <div className="mt-8 flex flex-wrap items-end gap-3">
            <Suspense fallback={null}>
              <LocationSelect searchParams={searchParams} />
            </Suspense>
            <button type="submit" className="btn btn-primary">Find the brief</button>
          </div>
        </Form>
        <p className="mt-8 max-w-[60ch] text-ink-soft">
          Each brief ranks the topics to revise for one company&rsquo;s internship in Ireland, says how
          strong the evidence is for each, and links every claim to where it came from.
        </p>
      </section>

      <section aria-labelledby="results-heading" className="mx-auto max-w-6xl px-4 sm:px-6">
        <Suspense fallback={<p className="t-muted">Looking that up…</p>}>
          <Results searchParams={searchParams} />
        </Suspense>
      </section>
    </>
  );
}

async function QueryBlank({ searchParams }: { searchParams: Search }) {
  const { q = "" } = await searchParams;
  return (
    <input
      id="q"
      name="q"
      className="blank"
      defaultValue={q}
      placeholder="company"
      autoComplete="off"
      spellCheck={false}
      maxLength={80}
    />
  );
}

async function LocationSelect({ searchParams }: { searchParams: Search }) {
  const [{ location = "" }] = await Promise.all([searchParams, connection()]);
  const locations = await readLocations();
  return (
    <div className="field">
      <label htmlFor="location" className="t-small">Location</label>
      <select id="location" name="location" defaultValue={location} className="input min-w-48">
        <option value="">Anywhere in Ireland</option>
        {locations
          .filter((l) => l.slug !== "ireland")
          .map((l) => (
            <option key={l.slug} value={l.slug}>{l.name}</option>
          ))}
      </select>
    </div>
  );
}

async function Results({ searchParams }: { searchParams: Search }) {
  const [{ q = "", location = "" }] = await Promise.all([searchParams, connection()]);
  const searching = q.trim() !== "" || location !== "";
  if (!searching) return <Published />;

  const results = await readSearch(q, location);
  return (
    <div>
      <h2 id="results-heading" className="t-h2">
        {results.length ? `Results for “${q || "all companies"}”` : `Nothing yet for “${q}”`}
      </h2>
      {results.length === 0 ? (
        <div className="mt-4 max-w-[60ch] text-ink-soft space-y-4">
          <p>
            We have no evidence on this company yet. If you have interviewed there, a short report is
            the fastest way to get it covered for the next student.
          </p>
          <Link href={`/contribute?company=${encodeURIComponent(q)}`} className="btn btn-primary">
            Share your interview
          </Link>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule border-y border-rule">
          {results.map((c) => (
            <li key={c.companySlug} className="py-5 grid gap-3 sm:grid-cols-[minmax(10rem,16rem)_1fr]">
              <p className="t-h3">{c.companyName}</p>
              {c.programmes.length === 0 ? (
                <p className="t-muted">No programme set up yet.</p>
              ) : (
                <ul className="grid gap-2">
                  {c.programmes.map((p) => (
                    <li key={p.slug} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <Link href={`/prep/${c.companySlug}/${p.slug}`} className="font-medium">
                        {p.role}
                        {p.location ? `, ${p.location}` : ""}
                      </Link>
                      {p.coverage === "published" && p.topLabel ? (
                        <Evidence label={p.topLabel} compact />
                      ) : (
                        <span className="t-small t-muted">No brief yet</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Published() {
  const rows = await readPublished();
  if (!rows.length) {
    return (
      <div className="border-t border-rule pt-8 max-w-[62ch]">
        <h2 id="results-heading" className="t-h2">The first briefs are being checked</h2>
        <p className="mt-3 text-ink-soft">
          Nothing is published until a person has read every source behind it. While that happens,
          the most useful thing you can do is tell us about an interview you have had.
        </p>
        <Link href="/contribute" className="btn btn-quiet mt-5">Share your interview</Link>
      </div>
    );
  }
  return (
    <div className="border-t border-rule pt-8">
      <h2 id="results-heading" className="t-h2">Recently checked briefs</h2>
      <ul className="mt-5 grid gap-x-10 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={`${r.companySlug}/${r.programmeSlug}`} className="border-b border-rule py-4">
            <Link href={`/prep/${r.companySlug}/${r.programmeSlug}`} className="no-underline group">
              <span className="t-h3 group-hover:underline">{r.companyName}</span>
              <span className="block t-small t-muted mt-1">
                {r.role}
                {r.location ? `, ${r.location}` : ""}. Checked {shortDate(r.publishedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
