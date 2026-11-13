import Link from "next/link";
import { connection } from "next/server";
import { listRuns } from "@/admin/queries";
import { AdminScreen, Status, type AdminSearch } from "@/components/admin";
import { shortDate } from "@/components/format";
import { getDb } from "@/db/client";

export default function RunsPage({ searchParams }: { searchParams: AdminSearch }) {
  return (
    <AdminScreen searchParams={searchParams}>
      <Runs searchParams={searchParams} />
    </AdminScreen>
  );
}

async function Runs({ searchParams }: { searchParams: AdminSearch }) {
  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  await connection();
  const runs = await listRuns(getDb(), page);
  return (
    <div>
      <h1 className="t-h1">Research runs</h1>
      <p className="mt-2 t-muted max-w-[64ch]">
        Runs are queued from an internship&rsquo;s page and carried out by the worker
        (<code>npm run research:worker</code>). Nothing a run finds is public until you review it.
      </p>
      {runs.length === 0 ? (
        <p className="mt-6 t-muted">No runs yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left t-small">
            <thead className="t-muted">
              <tr className="border-b border-rule">
                <th className="py-2 pr-4 font-medium">Run</th>
                <th className="py-2 pr-4 font-medium">Internship</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Claims</th>
                <th className="py-2 pr-4 font-medium">Cost</th>
                <th className="py-2 pr-4 font-medium">Queued</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(({ run, companyName, programmeSlug }) => (
                <tr key={run.id} className="border-b border-rule">
                  <td className="py-3 pr-4"><Link href={`/admin/runs/${run.id}`}>#{run.id}</Link></td>
                  <td className="py-3 pr-4">{companyName} <span className="t-muted">{programmeSlug}</span></td>
                  <td className="py-3 pr-4"><Status value={run.status} /></td>
                  <td className="py-3 pr-4 tabular-nums">{run.stats.claims ?? 0}</td>
                  <td className="py-3 pr-4 tabular-nums">${Number(run.costUsd).toFixed(2)}</td>
                  <td className="py-3 pr-4">{shortDate(run.queuedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex gap-3 t-small">
        {page > 0 && <Link href={`/admin/runs?page=${page - 1}`}>Newer</Link>}
        {runs.length === 25 && <Link href={`/admin/runs?page=${page + 1}`}>Older</Link>}
      </div>
    </div>
  );
}
