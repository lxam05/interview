import { Suspense } from "react";
import { requireAdmin } from "@/admin/session";

export type AdminSearch = Promise<Record<string, string | string[] | undefined>>;

/** Shows the ?done= / ?error= outcome of the last action. */
export async function Flash({ searchParams }: { searchParams: AdminSearch }) {
  const sp = await searchParams;
  const done = typeof sp.done === "string" ? sp.done : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  if (!done && !error) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className="mb-6 rounded-md px-4 py-3 font-medium"
      style={
        error
          ? { background: "var(--danger-soft)", color: "var(--danger)" }
          : { background: "var(--strong-soft)", color: "var(--strong)" }
      }
    >
      {error ?? done}
    </p>
  );
}

/** Every admin screen: auth check first, then content, behind one boundary. */
export function AdminScreen({ children, searchParams }: { children: React.ReactNode; searchParams: AdminSearch }) {
  return (
    <Suspense fallback={<p className="t-muted">Loading…</p>}>
      <Guard>
        <Flash searchParams={searchParams} />
        {children}
      </Guard>
    </Suspense>
  );
}

async function Guard({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}

const STATUS_TONE: Record<string, string> = {
  published: "var(--strong)",
  approved: "var(--strong)",
  succeeded: "var(--strong)",
  resolved: "var(--strong)",
  draft: "var(--ink-soft)",
  extracted: "var(--caution)",
  pending: "var(--caution)",
  queued: "var(--caution)",
  running: "var(--caution)",
  partial: "var(--caution)",
  open: "var(--caution)",
  rejected: "var(--danger)",
  failed: "var(--danger)",
  unpublished: "var(--muted)",
  dismissed: "var(--muted)",
};

export function Status({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 t-small font-medium" style={{ color: STATUS_TONE[value] ?? "var(--muted)" }}>
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: "currentColor" }} />
      {value.replace(/_/g, " ")}
    </span>
  );
}
