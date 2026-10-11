import type { FinalTrialResult } from "@/lib/trial-workflow";

export function TrialResearchResults({ result }: { result: FinalTrialResult }) {
  return (
    <section aria-label="Ranked clinical trials" className="space-y-4">
      <h2 className="text-lg font-medium">Your trial matches</h2>
      <p role="status" className="text-sm text-muted-foreground">
        {result.studies.length} potential matches from {result.evaluatedCount} shortlisted trials.
      </p>
      <p className="text-xs text-muted-foreground">These are potential matches, not confirmed eligibility. The study team must confirm any unanswered requirements.</p>
      {result.studies.length === 0 && (
        <p className="text-sm">None of the shortlisted trials matched your answers. You can edit your answers or start a new search.</p>
      )}
      {result.studies.map((trial) => (
        <article key={trial.id} className="rounded-xl border border-border p-4 sm:p-5">
          <p className="text-xs text-muted-foreground">Rank {trial.rank} · {trial.id}</p>
          <h3 className="mt-2 font-medium">
            <a href={`https://clinicaltrials.gov/study/${encodeURIComponent(trial.id)}`} target="_blank" rel="noreferrer" className="hover:underline">{trial.title}</a>
          </h3>
          <p className="mt-3 whitespace-pre-line text-sm leading-6">{trial.explanation}</p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer">Study details and eligibility</summary>
            <div className="mt-2 space-y-2 text-muted-foreground">
              <p className="whitespace-pre-line">{trial.summary}</p>
              <p>Status: {trial.status.replaceAll("_", " ")}</p>
              <p>Age: {trial.eligibility.minimumAge || "Not provided"} – {trial.eligibility.maximumAge || "Not provided"}</p>
              <p>Sex: {trial.eligibility.sex || "Not provided"}</p>
              <p className="whitespace-pre-line">{trial.eligibility.criteria}</p>
            </div>
          </details>
        </article>
      ))}
    </section>
  );
}
