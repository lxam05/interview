import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ContributeForm } from "@/components/contribute-form";

export const metadata: Metadata = {
  title: "Share your interview",
  description: "Tell the next student what your tech internship interview in Ireland was like. Anonymous by default.",
};

type Search = Promise<{ company?: string }>;

export default function ContributePage({ searchParams }: { searchParams: Search }) {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-16 grid gap-12 lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:gap-20">
      <div>
        <h1 className="t-h1">Share your interview</h1>
        <p className="mt-4 text-ink-soft max-w-[58ch]">
          Five minutes of your time tells the next student what to revise. Reports are anonymous
          unless you add a name, and a person reads each one before it is used.
        </p>
        <div className="mt-10">
          <Suspense fallback={<p className="t-muted">Loading the form…</p>}>
            <WithCompany searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
      <aside className="lg:pt-24 t-small text-ink-soft grid gap-6 content-start max-w-[44ch]">
        <div>
          <h2 className="font-semibold text-ink">Before you write</h2>
          <p className="mt-2">
            Describe topics and formats, not exact questions. If you signed an agreement not to share
            questions, keep to the kind of thing that came up, like &ldquo;a graph problem&rdquo;.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-ink">Leave people out</h2>
          <p className="mt-2">Please don&rsquo;t name interviewers or other candidates. We remove names we find.</p>
        </div>
        <div>
          <h2 className="font-semibold text-ink">What happens next</h2>
          <p className="mt-2">
            A moderator matches your report to the right internship and checks it reads as a real
            interview. Approved reports count as one firsthand source in that company&rsquo;s brief.
          </p>
        </div>
      </aside>
    </div>
  );
}

async function WithCompany({ searchParams }: { searchParams: Search }) {
  const { company = "" } = await searchParams;
  await connection();
  // Request time, after connection(): this component never prerenders.
  const now = new Date();
  return <ContributeForm defaultCompany={company.slice(0, 120)} year={now.getFullYear()} renderedAt={now.getTime()} />;
}
