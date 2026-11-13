import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-16">
      <h1 className="t-h1">Privacy</h1>
      <div className="prose-notes mt-6 space-y-4">
        <h2 className="t-h3 text-ink font-sans">What we collect</h2>
        <p>
          When you send an interview report or an error report we store what you typed. If you add a
          name or email we store those too; both are optional. We do not use tracking cookies or
          analytics.
        </p>
        <p>
          To stop spam we store a scrambled version of your connection&rsquo;s address that cannot be
          turned back into the address. It is deleted after 30 days.
        </p>
        <h2 className="t-h3 text-ink font-sans pt-4">How reports are used</h2>
        <p>
          A moderator reads each report, removes names of other people, and decides whether it is
          used. Briefs show short extracts and summaries, never your full report.
        </p>
        <h2 className="t-h3 text-ink font-sans pt-4">Public sources</h2>
        <p>
          Briefs quote short passages from public pages and link to them. If a page about you is
          quoted and you want it removed, use &ldquo;Spotted something wrong&rdquo; at the bottom of the
          brief and choose &ldquo;Remove something about me&rdquo;.
        </p>
        <h2 className="t-h3 text-ink font-sans pt-4">Removing your report</h2>
        <p>
          Use the same form on any brief and say which report is yours and roughly when you sent it.
          We remove it and rebuild the brief without it.
        </p>
      </div>
    </div>
  );
}
