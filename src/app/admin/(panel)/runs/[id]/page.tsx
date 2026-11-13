import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { runDetail } from "@/admin/queries";
import { AdminScreen, Status, type AdminSearch } from "@/components/admin";
import { hostOf, shortDate } from "@/components/format";
import { getDb } from "@/db/client";

type Params = Promise<{ id: string }>;

export default function RunPage({ params, searchParams }: { params: Params; searchParams: AdminSearch }) {
  return (
    <AdminScreen searchParams={searchParams}>
      <Run params={params} />
    </AdminScreen>
  );
}

async function Run({ params }: { params: Params }) {
  const id = Number((await params).id);
  await connection();
  const detail = Number.isInteger(id) ? await runDetail(getDb(), id) : null;
  if (!detail) notFound();
  const { run, events, sources, usage } = detail;
  const problems = events.filter((e) => e.errorCode);

  return (
    <div className="grid gap-10">
      <header>
        <p className="t-small t-muted"><Link href="/admin/runs">Research runs</Link></p>
        <h1 className="t-h1 mt-1 flex flex-wrap items-baseline gap-x-4">Run #{run.id} <Status value={run.status} /></h1>
        <p className="mt-2 text-ink-soft">
          <Link href={`/admin/programmes/${run.programmeId}`}>{detail.companyName}, {detail.programmeSlug}</Link>. Queued{" "}
          {shortDate(run.queuedAt)} by {run.requestedBy}. Cost ${Number(run.costUsd).toFixed(4)}
          {run.maxCostUsd ? ` of a $${Number(run.maxCostUsd).toFixed(2)} limit` : ""}.
        </p>
        {run.status === "queued" && (
          <p className="mt-3 t-small t-muted">Waiting for the worker. Start it with <code>npm run research:worker</code>.</p>
        )}
        {run.error && <p className="mt-3" style={{ color: "var(--danger)" }}>{run.error}</p>}
      </header>

      <section>
        <h2 className="t-h2">Numbers</h2>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-3">
          {Object.entries(run.stats).map(([k, v]) => (
            <div key={k} className="border-b border-rule pb-2">
              <dt className="t-small t-muted">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
              <dd className="t-h3 tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {problems.length > 0 && (
        <section>
          <h2 className="t-h2">Skipped or failed</h2>
          <ul className="mt-3 grid gap-2 t-small">
            {problems.map((e) => (
              <li key={e.id}>
                <code>{e.errorCode}</code> at {e.stage}: {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="t-h2">Sources ({sources.length})</h2>
        <ul className="mt-3 grid gap-2 t-small">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap gap-x-3">
              <Status value={s.status === "retrieved" ? "succeeded" : s.status} />
              {s.platform === "community" ? s.title : <a href={s.canonicalUrl} rel="noopener noreferrer nofollow">{s.title ?? hostOf(s.canonicalUrl)}</a>}
              {s.statusReason && <span className="t-muted">{s.statusReason}</span>}
            </li>
          ))}
        </ul>
      </section>

      {usage.length > 0 && (
        <section>
          <h2 className="t-h2">API usage</h2>
          <ul className="mt-3 grid gap-1 t-small tabular-nums">
            {usage.map((u) => (
              <li key={u.id}>
                {u.provider} {u.kind}: {u.calls} calls, {u.inputTokens} in, {u.outputTokens} out, ${Number(u.costUsd).toFixed(4)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="t-h2">Event log</h2>
        <ol className="mt-3 grid gap-1 t-small">
          {events.map((e) => (
            <li key={e.id} className="t-muted">
              {e.stage} {e.outcome}{e.durationMs != null ? ` in ${e.durationMs} ms` : ""}{e.message ? `: ${e.message}` : ""}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
