import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-24">
      <h1 className="t-h1">That page does not exist</h1>
      <p className="mt-4 text-ink-soft max-w-[52ch]">
        The company or internship may not be set up yet. Search for it, or tell us about your
        interview so it can be covered.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href="/" className="btn btn-primary">Search companies</Link>
        <Link href="/contribute" className="btn btn-quiet">Share your interview</Link>
      </div>
    </main>
  );
}
