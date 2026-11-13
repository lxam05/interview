import { Suspense } from "react";
import { login } from "@/actions/admin";
import { Flash, type AdminSearch } from "@/components/admin";

export const metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default function LoginPage({ searchParams }: { searchParams: AdminSearch }) {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <form action={login} className="w-full max-w-sm grid gap-5">
        <h1 className="t-h2">Review desk</h1>
        <Suspense fallback={null}>
          <Flash searchParams={searchParams} />
        </Suspense>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" className="input" required autoComplete="current-password" autoFocus />
        </div>
        <button type="submit" className="btn btn-primary">Sign in</button>
      </form>
    </main>
  );
}
