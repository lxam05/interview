import Link from "next/link";
import { logout } from "@/actions/admin";

export const metadata = { title: "Review", robots: { index: false, follow: false } };

const NAV = [
  ["/admin", "Overview"],
  ["/admin/runs", "Research runs"],
  ["/admin/submissions", "Student reports"],
  ["/admin/corrections", "Error reports"],
] as const;

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b border-rule bg-raised">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 min-h-14 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/admin" className="no-underline font-semibold">Review desk</Link>
            <nav aria-label="Admin" className="flex flex-wrap gap-x-5 gap-y-1 t-small">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="no-underline hover:underline">{label}</Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 t-small">
            <Link href="/" className="t-muted">View site</Link>
            <form action={logout}>
              <button className="btn btn-quiet btn-sm" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-8 flex-1">{children}</main>
    </div>
  );
}
