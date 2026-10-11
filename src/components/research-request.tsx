"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { RequestForm, type SearchRequest } from "@/components/request-form";
import { ResearchResultsReader } from "@/components/research-results-reader";
import { TrialQuestions } from "@/components/trial-questions";
import { requestResearchSearch, requestMedicalAnswers, type ResearchSearchResult } from "@/lib/research-search-client";
import type { TrialAnswer } from "@/lib/medical-research-types";

type ResearchRequestProps = {
  onResults?: (results: ResearchSearchResult, request: SearchRequest, signal: AbortSignal) => void | Promise<void>;
};

export function ResearchRequest({ onResults }: ResearchRequestProps) {
  const [result, setResult] = useState<ResearchSearchResult | null>(null);
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const answerController = useRef<AbortController | null>(null);
  useEffect(() => () => answerController.current?.abort(), []);

  function resetResults() {
    answerController.current?.abort();
    answerController.current = null;
    setResult(null);
    setRequest(null);
  }

  async function submitAnswers(answers: TrialAnswer[]) {
    if (result?.status !== "questions" || !request || answerController.current) return;
    const controller = new AbortController();
    answerController.current = controller;
    try {
      await new Promise<void>((resolve, reject) => startTransition(async () => {
        try {
          const next = await requestMedicalAnswers(result.sessionId, answers, controller.signal);
          await onResults?.(next, request, controller.signal);
          if (!controller.signal.aborted) setResult(next);
          resolve();
        } catch (error) { reject(error); }
      }));
    } finally {
      if (answerController.current === controller) answerController.current = null;
    }
  }

  async function search(input: SearchRequest, signal: AbortSignal) {
    resetResults();
    setRequest(input);
    await new Promise<void>((resolve, reject) => startTransition(async () => {
      try {
        const next = await requestResearchSearch(input, signal);
        await onResults?.(next, input, signal);
        if (!signal.aborted) setResult(next);
        resolve();
      } catch (error) { reject(error); }
    }));
  }

  return <RequestForm onSubmit={search} onEdit={resetResults} completedContent={result && (
    <section aria-label="Research search results" className="space-y-5">
      {result.status === "questions" ? (
        <>
          <p className="text-sm text-muted-foreground">The research agent needs a few answers to narrow your trial matches.</p>
          <TrialQuestions key={JSON.stringify(result.questions.map(question => question.id))}
            questions={result.questions} onSubmit={submitAnswers} />
        </>
      ) : <ResearchResultsReader result={result.report} request={request!} />}
      <details className="rounded-lg border border-border bg-muted/30 p-4">
        <summary className="cursor-pointer text-sm font-medium">View results JSON</summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </section>
  )} />;
}
