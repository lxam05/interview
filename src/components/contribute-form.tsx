"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { sendReport, type ReportState } from "@/actions/public";
import { CANONICAL_TOPICS, INTERVIEW_STAGE_TEXT, INTERVIEW_STAGES } from "@/domain/constants";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ContributeForm({
  defaultCompany,
  year,
  renderedAt,
}: {
  defaultCompany: string;
  year: number;
  /** Server time when the form was rendered; the server checks it against its own clock. */
  renderedAt: number;
}) {
  const [state, action, pending] = useActionState<ReportState, FormData>(sendReport, { status: "idle" });
  const summaryRef = useRef<HTMLDivElement>(null);
  // One key per filled-in form, so a double click or a retry is stored once.
  const key = useRef<string | null>(null);
  const submit = (form: FormData) => {
    key.current ??= crypto.randomUUID();
    form.set("startedAt", String(renderedAt));
    form.set("idempotencyKey", key.current);
    action(form);
  };
  useEffect(() => {
    if (state.status !== "idle") summaryRef.current?.focus();
  }, [state]);

  if (state.status === "sent") {
    const r = state.reflection;
    return (
      <div ref={summaryRef} tabIndex={-1} role="status" className="outline-none">
        <h2 className="t-h2">Report sent. Here is yours, organised.</h2>
        {r.stage ? (
          <div className="mt-6 border-l-2 pl-5 grid gap-4" style={{ borderColor: "var(--highlight)" }}>
            <p className="t-h3">{r.headline}</p>
            <p className="t-small t-muted">{r.when}</p>
            {r.topics.length > 0 && (
              <p className="prose-notes">
                <span className="font-semibold text-ink">Topics you saw: </span>
                {r.topics.join(", ")}
              </p>
            )}
            <ul className="prose-notes list-disc pl-5 space-y-1">
              {r.checklist.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-6 text-ink-soft max-w-[58ch]">
          A moderator will read it soon. Once approved it counts as one firsthand report in the
          brief, without your name unless you gave one.
        </p>
        <Link href="/" className="btn btn-quiet mt-6">Back to search</Link>
      </div>
    );
  }

  const errs = state.status === "error" ? state.fieldErrors : {};
  const val = (k: string) => (state.status === "error" ? (state.values[k] as string | undefined) : undefined);
  const picked = new Set(state.status === "error" ? (state.values.topicSlugs as string[]) : []);
  const err = (k: string) =>
    errs[k] ? (
      <p id={`${k}-error`} className="error">
        {errs[k]}
      </p>
    ) : null;
  const a11y = (k: string) => ({ "aria-invalid": !!errs[k], "aria-describedby": errs[k] ? `${k}-error` : undefined });

  return (
    <form action={submit} className="grid gap-8" noValidate>
      <div ref={summaryRef} tabIndex={-1} className="outline-none">
        {state.status === "error" && (
          <p role="alert" className="rounded-md p-4 font-medium" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
            {state.message}
          </p>
        )}
      </div>
      <div className="sr-only" aria-hidden="true">
        <label>
          Leave this empty <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <fieldset className="grid gap-5">
        <legend className="t-h3 mb-4">The internship</legend>
        <div className="field">
          <label htmlFor="companyName">Company</label>
          <input id="companyName" name="companyName" className="input" required maxLength={120} defaultValue={val("companyName") ?? defaultCompany} {...a11y("companyName")} />
          {err("companyName")}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="roleName">Role</label>
            <input id="roleName" name="roleName" className="input" required maxLength={120} defaultValue={val("roleName") ?? "Software Engineering Intern"} {...a11y("roleName")} />
            {err("roleName")}
          </div>
          <div className="field">
            <label htmlFor="locationName">Where the role was based</label>
            <input id="locationName" name="locationName" className="input" required maxLength={120} placeholder="Dublin" defaultValue={val("locationName")} {...a11y("locationName")} />
            {err("locationName")}
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="interviewMonth">Month of the interview</label>
            <select id="interviewMonth" name="interviewMonth" className="input" defaultValue={val("interviewMonth") ?? ""}>
              <option value="">Not sure</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="interviewYear">Year</label>
            <select id="interviewYear" name="interviewYear" className="input" defaultValue={val("interviewYear") ?? String(year)} {...a11y("interviewYear")}>
              {Array.from({ length: 6 }, (_, i) => year - i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {err("interviewYear")}
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="t-h3 mb-4">The stage you are describing</legend>
        <div className="field">
          <label htmlFor="stage">Stage</label>
          <select id="stage" name="stage" className="input" required defaultValue={val("stage") ?? ""} {...a11y("stage")}>
            <option value="" disabled>Choose one</option>
            {INTERVIEW_STAGES.map((s) => (
              <option key={s} value={s}>{INTERVIEW_STAGE_TEXT[s]}</option>
            ))}
          </select>
          {err("stage")}
        </div>
        <div className="field">
          <label htmlFor="format">Format</label>
          <p id="format-hint" className="hint">Platform, length, number of questions, who was in the room.</p>
          <input id="format" name="format" className="input" required maxLength={600} placeholder="HackerRank, 90 minutes, two coding questions" defaultValue={val("format")} aria-invalid={!!errs.format} aria-describedby={`format-hint${errs.format ? " format-error" : ""}`} />
          {err("format")}
        </div>
        <fieldset className="field">
          <legend>Topics that came up</legend>
          <div className="mt-1 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {CANONICAL_TOPICS.map((t) => (
              <label key={t.slug} className="inline-flex items-center gap-2">
                <input type="checkbox" name="topicSlugs" value={t.slug} defaultChecked={picked.has(t.slug)} className="h-4 w-4 accent-[var(--ink)]" />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="topics">What came up, in your words</label>
          <p id="topics-hint" className="hint">The kind of problem, not the exact wording.</p>
          <textarea id="topics" name="topics" className="input" required maxLength={3000} defaultValue={val("topics")} aria-invalid={!!errs.topics} aria-describedby={`topics-hint${errs.topics ? " topics-error" : ""}`} />
          {err("topics")}
        </div>
        <fieldset className="field">
          <legend>How hard did it feel?</legend>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
            {["1", "2", "3", "4", "5"].map((d) => (
              <label key={d} className="inline-flex items-center gap-2">
                <input type="radio" name="difficulty" value={d} defaultChecked={val("difficulty") === d} className="accent-[var(--ink)]" />
                {d === "1" ? "1, easy" : d === "5" ? "5, very hard" : d}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="advice">One piece of advice for the next student</label>
          <textarea id="advice" name="advice" className="input" maxLength={1500} defaultValue={val("advice")} />
        </div>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="t-h3 mb-4">About you</legend>
        <div className="field">
          <label htmlFor="displayName">Name to show (optional)</label>
          <p id="displayName-hint" className="hint">Leave empty to stay anonymous.</p>
          <input id="displayName" name="displayName" className="input" maxLength={60} defaultValue={val("displayName")} aria-describedby="displayName-hint" />
        </div>
        <div className="field">
          <label className="inline-flex items-start gap-3 font-normal">
            <input type="checkbox" name="consent" className="mt-1 h-4 w-4 accent-[var(--ink)]" {...a11y("consent")} />
            <span>
              I took part in this interview, I have not included anything I agreed to keep
              confidential, and I agree to this report being used as described in the{" "}
              <Link href="/privacy">privacy notice</Link>.
            </span>
          </label>
          {err("consent")}
        </div>
      </fieldset>

      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Sending…" : "Send report"}
        </button>
      </div>
    </form>
  );
}
