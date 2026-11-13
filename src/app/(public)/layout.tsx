import Link from "next/link";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only-focusable btn btn-primary absolute left-4 top-3 z-10">
        Skip to content
      </a>
      <header className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="no-underline font-semibold tracking-tight text-[1.0625rem]">
            Interview prep <span className="hidden sm:inline text-muted font-normal">for Irish internships</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-5 t-small">
            <Link href="/method" className="hidden sm:inline no-underline hover:underline">How we rank</Link>
            <Link href="/contribute" className="btn btn-quiet btn-sm">Share your interview</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-rule mt-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid gap-6 sm:grid-cols-[1fr_auto] t-small text-muted">
          <p className="max-w-[60ch]">
            Built from public sources and reports by students. Every brief is checked by a person
            before it goes up. Interviews change between teams and years, so treat this as a guide,
            not a guarantee.
          </p>
          <nav aria-label="Footer" className="flex gap-5 sm:justify-end">
            <Link href="/method">How we rank</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/contribute">Share your interview</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
