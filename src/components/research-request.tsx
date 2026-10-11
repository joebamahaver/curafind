"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { RequestForm, type SearchRequest } from "@/components/request-form";
import { ResearchResultsReader } from "@/components/research-results-reader";
import {
  requestResearchSearch,
  type ResearchSearchResult,
} from "@/lib/research-search-client";
import type { TrialAnswer, FinalTrialResult } from "@/lib/trial-evaluation-types"

type ResearchRequestProps = {
  onResults?: (
    results: ResearchSearchResult,
    request: SearchRequest,
    signal: AbortSignal,
  ) => void | Promise<void>;
};

export function ResearchRequest({ onResults }: ResearchRequestProps) {
  const [result, setResult] = useState<ResearchSearchResult | null>(null);
  const [condition, setCondition] = useState("");
  const [rankedTrials, setRankedTrials] = useState<FinalTrialResult | null>(null);
  const rankingController = useRef<AbortController | null>(null);

  useEffect(() => () => rankingController.current?.abort(), []);

  function resetResults() {
    rankingController.current?.abort();
    rankingController.current = null;
    setResult(null);
    setRankedTrials(null);
  }

  async function submitTrialAnswers(answers: TrialAnswer[]) {
    if (!result?.clinicalTrials || rankingController.current) return;
    const controller = new AbortController();
    rankingController.current = controller;
    try {
      const response = await fetch("/api/trials/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ condition, prepared_trials: result.clinicalTrials, answers }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Trial evaluation failed.");
      if (!Array.isArray(data.studies)) throw new Error("Unexpected ranking response.");
      if (!controller.signal.aborted) setRankedTrials(data);
    } finally {
      if (rankingController.current === controller) rankingController.current = null;
    }
  }

  async function search(request: SearchRequest, signal: AbortSignal) {
    resetResults();
    setCondition(request.condition.trim());
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
      onEdit={resetResults}
      completedContent={result && (
        <section aria-label="Research search results" className="space-y-4">
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {[
              result.clinicalTrials && `${result.clinicalTrials.trialSums.length} clinical trials`,
              result.drugResearch && `${result.drugResearch.evaluatedCount} evaluated drug studies`,
            ].filter(Boolean).join(" and ")} retrieved.
          </p>
          {result.errors?.clinicalTrials && (
            <p role="alert" className="text-sm text-destructive">Clinical trials: {result.errors.clinicalTrials}</p>
          )}
          {result.errors?.drugResearch && (
            <p role="alert" className="text-sm text-destructive">Drug research: {result.errors.drugResearch}</p>
          )}
          <ResearchResultsReader
            result={result}
            rankedTrials={rankedTrials}
            onSubmitAnswers={submitTrialAnswers}
            onEditAnswers={() => setRankedTrials(null)}
          />
          <details className="rounded-lg border border-border bg-muted/30 p-4">
            <summary className="cursor-pointer text-sm font-medium">View results JSON</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap wrap-break-word text-xs">
              {JSON.stringify({ ...result, rankedTrials }, null, 2)}
            </pre>
          </details>
        </section>
      )}
    />
  );
}
