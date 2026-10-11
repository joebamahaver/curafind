"use client";

import { startTransition, useState } from "react";
import { RequestForm, type SearchRequest } from "@/components/request-form";
import { DrugResearchResults } from "@/components/drug-research-results";
import {
  requestResearchSearch,
  type ResearchSearchResult,
} from "@/lib/research-search-client";

type ResearchRequestProps = {
  onResults?: (
    results: ResearchSearchResult,
    request: SearchRequest,
    signal: AbortSignal,
  ) => void | Promise<void>;
};

export function ResearchRequest({ onResults }: ResearchRequestProps) {
  const [result, setResult] = useState<ResearchSearchResult | null>(null);

  async function search(request: SearchRequest, signal: AbortSignal) {
    setResult(null);
    // RequestForm awaits this promise to keep its loading animation active.
    await new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        try {
          const results = await requestResearchSearch(request, signal);
          if (!signal.aborted) {
            // Scored drug JSON remains available at results.drugResearch.articles.
            await onResults?.(results, request, signal);
            if (!signal.aborted) setResult(results);
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  return (
    <RequestForm
      onSubmit={search}
      onEdit={() => setResult(null)}
      completedContent={result && (
        <section aria-label="Research search results" className="space-y-4">
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {[
              result.clinicalTrials && `${result.clinicalTrials.studies.length} clinical trials`,
              result.drugResearch && `${result.drugResearch.evaluatedCount} evaluated drug studies`,
            ].filter(Boolean).join(" and ")} retrieved.
          </p>
          {result.errors?.clinicalTrials && (
            <p role="alert" className="text-sm text-destructive">Clinical trials: {result.errors.clinicalTrials}</p>
          )}
          {result.errors?.drugResearch && (
            <p role="alert" className="text-sm text-destructive">Drug research: {result.errors.drugResearch}</p>
          )}
          {result.clinicalTrials?.nextPageToken && (
            <p className="text-xs text-muted-foreground">
              More clinical trial results are available beyond this page.
            </p>
          )}
          {result.drugResearch && <DrugResearchResults result={result.drugResearch} />}
          <details className="rounded-lg border border-border bg-muted/30 p-4">
            <summary className="cursor-pointer text-sm font-medium">View results JSON</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </section>
      )}
    />
  );
}
