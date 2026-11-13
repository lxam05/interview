"use client";

import { useActionState } from "react";
import { sendCorrection, type CorrectionState } from "@/actions/public";

export function ReportError({ programmeId }: { programmeId: number }) {
  const [state, action, pending] = useActionState<CorrectionState, FormData>(sendCorrection, { status: "idle" });

  return (
    <section id="report" aria-labelledby="report-heading" className="max-w-[62ch]">
      <details open={state.status === "error"} className="group">
        <summary className="t-h3 inline-flex items-center gap-2" id="report-heading">
          <span aria-hidden="true" className="inline-block text-muted transition-transform group-open:rotate-90">›</span>
          Spotted something wrong or out of date?
        </summary>
        {state.status === "sent" ? (
          <p role="status" className="mt-4 text-ink-soft">
            Report sent. A person reads every one, usually within a week.
          </p>
        ) : (
          <form action={action} className="mt-5 grid gap-5">
            <input type="hidden" name="programmeId" value={programmeId} />
            <div className="sr-only" aria-hidden="true">
              <label>
                Leave this empty <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <fieldset className="field">
              <legend>What kind of problem?</legend>
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2">
                {[
                  ["error", "Something is wrong"],
                  ["outdated", "It is out of date"],
                  ["removal_request", "Remove something about me"],
                ].map(([value, label], i) => (
                  <label key={value} className="inline-flex items-center gap-2">
                    <input type="radio" name="kind" value={value} defaultChecked={i === 0} className="accent-[var(--ink)]" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="correction-message">What should change?</label>
              <textarea
                id="correction-message"
                name="message"
                className="input"
                required
                minLength={10}
                maxLength={2000}
                aria-invalid={state.status === "error" && !!state.fieldErrors.message}
                aria-describedby="correction-message-error"
              />
              {state.status === "error" && (
                <p id="correction-message-error" className="error">
                  {state.fieldErrors.message ?? state.message}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="correction-contact">Email, if you want a reply</label>
              <input id="correction-contact" name="contact" type="email" className="input" maxLength={200} autoComplete="email" />
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? "Sending…" : "Send report"}
              </button>
            </div>
          </form>
        )}
      </details>
    </section>
  );
}
