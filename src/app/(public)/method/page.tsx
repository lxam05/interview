import type { Metadata } from "next";
import { Evidence } from "@/components/evidence";
import { EVIDENCE_LABEL_HELP, EVIDENCE_LABELS } from "@/domain/constants";

export const metadata: Metadata = {
  title: "How we rank topics",
  description: "How each brief is built: where evidence comes from, how it is labelled, and how topics are ranked.",
};

export default function MethodPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-16">
      <h1 className="t-h1 max-w-[20ch]">How we rank topics</h1>
      <div className="prose-notes mt-6 space-y-4">
        <p>
          Each brief covers one internship at one company in Ireland. We collect public sources (the
          employer&rsquo;s own pages, write-ups on GitHub and Hacker News, other public pages) and reports
          sent to us by students. Every statement we use keeps the exact words it came from, and we
          throw away any statement whose words are not really in the source.
        </p>
        <p>
          A person reads every claim before it can be used, and approves every brief before it is
          published. Nothing goes up automatically.
        </p>
      </div>

      <h2 className="t-h2 mt-14">Evidence labels</h2>
      <p className="mt-2 t-muted max-w-[60ch]">
        Labels follow fixed rules, so the same evidence always gets the same label. We never show a
        percentage, because we cannot know one.
      </p>
      <dl className="mt-6 border-t border-rule max-w-[62rem]">
        {EVIDENCE_LABELS.map((l) => (
          <div key={l} className="grid gap-2 sm:grid-cols-[18rem_minmax(0,1fr)] border-b border-rule py-4">
            <dt>
              <Evidence label={l} compact />
            </dt>
            <dd className="text-ink-soft">{EVIDENCE_LABEL_HELP[l]}</dd>
          </div>
        ))}
      </dl>

      <h2 className="t-h2 mt-14">Ranking</h2>
      <ol className="prose-notes mt-4 list-decimal pl-5 space-y-2">
        <li>Stronger evidence first, in the order of the labels above.</li>
        <li>Then the most recent report.</li>
        <li>Then the number of separate reports. Copies of the same report count once.</li>
      </ol>
      <p className="prose-notes mt-4">
        Reports about graduate roles or other countries are kept and shown, but they are labelled
        and always rank below evidence about the internship in Ireland.
      </p>
    </div>
  );
}
