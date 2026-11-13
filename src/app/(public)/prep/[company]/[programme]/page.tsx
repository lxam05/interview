import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { BriefStage, BriefTopic } from "@/briefs/content";
import { readBrief, type CachedBrief } from "@/briefs/read";
import type { PublicClaim } from "@/briefs/public";
import { Evidence } from "@/components/evidence";
import { hostOf, shortDate, yearMonth } from "@/components/format";
import { ReportError } from "@/components/report-error";
import { INTERVIEW_STAGE_TEXT, SOURCE_PLATFORM_TEXT } from "@/domain/constants";

type Params = Promise<{ company: string; programme: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { company, programme } = await params;
  await connection();
  const brief = await readBrief(company, programme);
  if (!brief) return { title: "Not found" };
  const where = brief.programme.location ? `, ${brief.programme.location}` : "";
  return {
    title: `${brief.company.name} ${brief.programme.role}${where}`,
    description: `What to study for the ${brief.company.name} ${brief.programme.role.toLowerCase()} interview${where}, ranked by evidence with sources.`,
  };
}

export default function PrepPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 t-muted">Loading the brief…</div>}>
      <Brief params={params} />
    </Suspense>
  );
}

async function Brief({ params }: { params: Params }) {
  const { company, programme } = await params;
  await connection();
  const brief = await readBrief(company, programme);
  if (!brief) notFound();

  return (
    <article className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-16">
      <header className="max-w-[62ch]">
        <p className="t-small t-muted">
          <Link href={`/?q=${encodeURIComponent(brief.company.name)}`}>{brief.company.name}</Link>
        </p>
        <h1 className="t-h1 mt-2">
          {brief.programme.role}
          {brief.programme.location ? `, ${brief.programme.location}` : ""}
        </h1>
        {brief.version ? (
          <p className="mt-3 text-ink-soft">
            Checked by a person on {shortDate(brief.version.publishedAt)}. Built from{" "}
            {countSources(brief)} {countSources(brief) === 1 ? "source" : "sources"}.
          </p>
        ) : null}
        {brief.siblings.length > 0 && (
          <p className="mt-3 t-small t-muted">
            Also at {brief.company.name}:{" "}
            {brief.siblings.map((s, i) => (
              <span key={s.slug}>
                {i > 0 && ", "}
                <Link href={`/prep/${brief.company.slug}/${s.slug}`}>
                  {s.role}
                  {s.location ? ` (${s.location})` : ""}
                </Link>
              </span>
            ))}
          </p>
        )}
      </header>

      {brief.version ? <Published brief={brief} /> : <NoBrief brief={brief} />}
    </article>
  );
}

function countSources(brief: CachedBrief) {
  return new Set(Object.values(brief.claims).map((c) => c.source.id)).size;
}

function NoBrief({ brief }: { brief: CachedBrief }) {
  return (
    <section className="mt-12 max-w-[62ch] border-t border-rule pt-8" aria-labelledby="none">
      <h2 id="none" className="t-h2">Not enough evidence for a brief yet</h2>
      <div className="prose-notes mt-4 space-y-4">
        <p>
          We have not found enough firsthand reports of this internship in Ireland to rank topics
          with any confidence, so we are not going to guess.
        </p>
        <p>
          What would change that: two or more reports from students who interviewed for this role in
          the last two years, or a description of the process on {brief.company.name}&rsquo;s own
          careers pages.
        </p>
        <p>
          Until then, general internship preparation (data structures, algorithms and one
          behavioural story per project on your CV) is a reasonable start. That is general advice,
          not evidence about {brief.company.name}.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={`/contribute?company=${encodeURIComponent(brief.company.name)}`} className="btn btn-primary">
          Share your {brief.company.name} interview
        </Link>
        {brief.company.website && (
          <a href={brief.company.website} className="btn btn-quiet" rel="noopener noreferrer">
            {brief.company.name} careers site
          </a>
        )}
      </div>
    </section>
  );
}

function Published({ brief }: { brief: CachedBrief }) {
  const content = brief.version!.content;
  const claimsOf = (ids: number[]) => ids.map((id) => brief.claims[id]).filter(Boolean) as PublicClaim[];
  const official = content.stages.filter((s) => s.origin === "official");
  const reported = content.stages.filter((s) => s.origin === "candidate");
  const sources = [...new Map(Object.values(brief.claims).map((c) => [c.source.id, c])).values()].sort(
    (a, b) => (b.interviewYear ?? 0) - (a.interviewYear ?? 0),
  );

  return (
    <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-16">
      <div className="min-w-0 space-y-16">
        <section aria-labelledby="study">
          <h2 id="study" className="t-h2">What should I study?</h2>
          <p className="mt-2 t-small t-muted max-w-[60ch]">
            Ranked by strength of evidence, then by how recent it is. The bars show evidence
            strength, not how likely a topic is to come up.
          </p>
          {content.topics.length === 0 ? (
            <p className="mt-6 prose-notes">No topics are supported well enough to list.</p>
          ) : (
            <ol className="rank-in mt-6 border-t border-rule">
              {content.topics.map((t) => (
                <TopicItem key={t.topicSlug} topic={t} claims={claimsOf(t.claimIds)} />
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="process">
          <h2 id="process" className="t-h2">What the interview looks like</h2>
          {official.length === 0 && reported.length === 0 ? (
            <p className="mt-4 prose-notes">No source describes the stages of this process yet.</p>
          ) : (
            <div className="mt-6 grid gap-10">
              {official.length > 0 && (
                <Stages title={`What ${brief.company.name} says`} stages={official} claimsOf={claimsOf} />
              )}
              {reported.length > 0 && (
                <Stages title="What candidates reported" stages={reported} claimsOf={claimsOf} />
              )}
            </div>
          )}
          {content.advice.length > 0 && (
            <div className="mt-10">
              <h3 className="t-h3">Advice from people who did it</h3>
              <ul className="mt-3 prose-notes list-disc pl-5 space-y-2">
                {content.advice.map((a, i) => (
                  <li key={i}>{a.text}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-labelledby="evidence">
          <h2 id="evidence" className="t-h2">Evidence and sources</h2>
          <div className="mt-4 rounded-md p-4 max-w-[62ch]" style={{ background: "var(--caution-soft)" }}>
            <h3 className="font-semibold">What we don&rsquo;t know</h3>
            <ul className="mt-2 list-disc pl-5 space-y-1 text-ink-soft">
              {content.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
          <ul className="mt-6 divide-y divide-rule border-y border-rule">
            {sources.map((c) => (
              <li key={c.source.id} className="py-4 grid gap-1">
                <SourceLink claim={c} />
                <p className="t-small t-muted">
                  {SOURCE_PLATFORM_TEXT[c.source.platform]}. {describeClaim(c)}. Retrieved{" "}
                  {shortDate(c.source.retrievedAt)}.
                </p>
              </li>
            ))}
          </ul>
        </section>

        <ReportError programmeId={brief.programme.id} />
      </div>

      <aside className="hidden lg:block">
        <nav aria-label="On this page" className="sticky top-8 t-small grid gap-2 border-l border-rule pl-4">
          <a href="#study" className="no-underline hover:underline">What should I study?</a>
          <a href="#process" className="no-underline hover:underline">What the interview looks like</a>
          <a href="#evidence" className="no-underline hover:underline">Evidence and sources</a>
          <a href="#report" className="no-underline hover:underline t-muted">Report an error</a>
        </nav>
      </aside>
    </div>
  );
}

function TopicItem({ topic, claims }: { topic: BriefTopic; claims: PublicClaim[] }) {
  const newest = yearMonth(topic.newestYear, topic.newestMonth);
  return (
    <li className="border-b border-rule py-6 grid grid-cols-[2.25rem_minmax(0,1fr)] sm:grid-cols-[3rem_minmax(0,1fr)] gap-x-3">
      <span className="t-h2 text-muted tabular-nums leading-none pt-1" aria-hidden="true">
        {topic.rank}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h3 className="t-h3">
            <span className="sr-only">Rank {topic.rank}: </span>
            {topic.name}
          </h3>
          <Evidence label={topic.label} />
        </div>
        <p className="prose-notes mt-2">{topic.why}</p>
        <p className="mt-2 t-small t-muted">
          {[
            topic.stages.length ? topic.stages.map((s) => INTERVIEW_STAGE_TEXT[s]).join(" and ") : null,
            newest ? `latest report ${newest}` : null,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>

        {topic.resources.length > 0 && (
          <p className="mt-3 t-small">
            <span className="t-muted">Free to study: </span>
            {topic.resources.map((r, i) => (
              <span key={r.url}>
                {i > 0 && ", "}
                <a href={r.url} rel="noopener noreferrer">{r.title}</a>
              </span>
            ))}
          </p>
        )}

        {claims.length > 0 && (
          <details className="mt-4 group">
            <summary className="t-small font-medium inline-flex items-center gap-2">
              <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">›</span>
              What the sources say ({claims.length})
            </summary>
            <ul className="mt-3 grid gap-4 border-l-2 border-rule pl-4">
              {claims.map((c) => (
                <li key={c.id}>
                  <p className="quote">
                    <mark>&ldquo;{c.quote}&rdquo;</mark>
                  </p>
                  <p className="mt-1 t-small t-muted">
                    <SourceLink claim={c} inline />. {describeClaim(c)}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

function Stages({
  title,
  stages,
  claimsOf,
}: {
  title: string;
  stages: BriefStage[];
  claimsOf: (ids: number[]) => PublicClaim[];
}) {
  return (
    <div>
      <h3 className="t-h3">{title}</h3>
      <ol className="mt-4 grid gap-0">
        {stages.map((s, i) => (
          <li key={`${s.stage}-${i}`} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-6 last:pb-0">
            <span
              aria-hidden="true"
              className="mt-[0.2rem] h-[1.4rem] w-[1.4rem] rounded-full border-2 border-ink grid place-items-center text-[0.75rem] font-semibold"
            >
              {i + 1}
            </span>
            {i < stages.length - 1 && (
              <span aria-hidden="true" className="absolute left-[0.65rem] top-[1.8rem] bottom-0 w-[2px] bg-rule" />
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <p className="font-semibold">
                  {INTERVIEW_STAGE_TEXT[s.stage]}
                  {s.durationMinutes ? <span className="font-normal t-muted">, about {s.durationMinutes} minutes</span> : null}
                </p>
                <Evidence label={s.label} compact />
              </div>
              <p className="prose-notes mt-1">{s.summary}</p>
              <p className="t-small t-muted mt-1">
                From{" "}
                {[...new Map(claimsOf(s.claimIds).map((c) => [c.source.id, c])).values()].map((c, j) => (
                  <span key={c.source.id}>
                    {j > 0 && ", "}
                    <SourceLink claim={c} inline />
                  </span>
                ))}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SourceLink({ claim, inline = false }: { claim: PublicClaim; inline?: boolean }) {
  const community = claim.source.platform === "community";
  const text = community
    ? inline
      ? "a student report sent to us"
      : "A student report sent to us"
    : inline
      ? hostOf(claim.source.url)
      : (claim.source.title ?? hostOf(claim.source.url));
  if (!claim.source.url) return <span className={inline ? "" : "font-medium"}>{text}</span>;
  return (
    <a href={claim.source.url} rel="noopener noreferrer nofollow" className={inline ? "" : "font-medium"}>
      {text}
    </a>
  );
}

function describeClaim(c: PublicClaim): string {
  const role = { intern: "Internship", graduate: "Graduate role", experienced: "Experienced hire", unknown: "Role not stated" }[c.roleLevel];
  const region = { ireland: "Ireland", international: "outside Ireland", unknown: "location not stated" }[c.region];
  const when = yearMonth(c.interviewYear, c.interviewMonth);
  const kind = c.firsthand ? "firsthand" : c.firsthand === false ? "second-hand" : null;
  return [`${role}, ${region}`, kind, when ? `interviewed ${when}` : null].filter(Boolean).join(", ");
}
