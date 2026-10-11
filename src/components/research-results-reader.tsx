"use client";

import { useState, type ReactNode } from "react";
import { BookOpen, ChevronLeft, ChevronRight, FlaskConical, Microscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DrugResearchResults } from "@/components/drug-research-results";
import { TrialResearchResults } from "@/components/trial-research-results";
import { TrialQuestions } from "@/components/trial-questions";
import type { ResearchSearchResult } from "@/lib/research-search-client";
import type { FinalTrialResult, TrialAnswer } from "@/lib/trial-workflow";

function ResultPages({ count, label, children }: {
  count: number;
  label: string;
  children: (index: number) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const index = Math.min(page, Math.max(0, count - 1));

  return (
    <div className="space-y-4">
      {count > 0 && (
        <nav aria-label={`${label} result pages`} className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <Button type="button" variant="outline" size="sm" disabled={index === 0}
            aria-label={`Previous ${label.toLowerCase()} result`} onClick={() => setPage(index - 1)}>
            <ChevronLeft aria-hidden="true" /><span className="hidden sm:inline">Previous</span>
          </Button>
          <p role="status" aria-live="polite" aria-atomic="true" className="text-center text-xs tabular-nums text-muted-foreground">
            {label} {index + 1} of {count}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={index >= count - 1}
            aria-label={`Next ${label.toLowerCase()} result`} onClick={() => setPage(index + 1)}>
            <span className="hidden sm:inline">Next</span><ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}
      <div key={index} tabIndex={0} aria-label={`${label} page content`}
        className="max-h-[60svh] min-h-64 overflow-y-auto overscroll-contain pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-96">
        {children(index)}
      </div>
    </div>
  );
}

type ResearchResultsReaderProps = {
  result: ResearchSearchResult;
  rankedTrials: FinalTrialResult | null;
  onSubmitAnswers: (answers: TrialAnswer[]) => Promise<void>;
  onEditAnswers: () => void;
};

export function ResearchResultsReader({ result, rankedTrials, onSubmitAnswers, onEditAnswers }: ResearchResultsReaderProps) {
  const drugResearch = result.drugResearch;
  return (
    <Tabs defaultValue={result.clinicalTrials ? "trials" : "research"} data-results-reader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList aria-label="Research chapters">
          {result.clinicalTrials && (
            <TabsTrigger value="trials"><Microscope className="size-4" aria-hidden="true" />Trials</TabsTrigger>
          )}
          {drugResearch && (
            <TabsTrigger value="research"><FlaskConical className="size-4" aria-hidden="true" />Research</TabsTrigger>
          )}
        </TabsList>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><BookOpen className="size-4" aria-hidden="true" />One result at a time</span>
      </div>
      <div className="rounded-r-2xl rounded-l-md border border-border border-l-4 border-l-primary/25 bg-[#fffdf8] p-4 shadow-[4px_4px_0_0_var(--muted),8px_8px_0_0_var(--border)] sm:p-6">
        {result.clinicalTrials && (
          <TabsContent value="trials" keepMounted className="space-y-4 break-words">
            {result.clinicalTrials.studies.length > 0 ? (
              <>
                <div hidden={rankedTrials !== null}>
                  <TrialQuestions
                    key={JSON.stringify(result.clinicalTrials.questions.map(({ id }) => id))}
                    questions={result.clinicalTrials.questions}
                    onSubmit={onSubmitAnswers}
                  />
                </div>
                {rankedTrials && (
                  <>
                    <ResultPages key={JSON.stringify(rankedTrials.studies.map(({ id }) => id))} count={rankedTrials.studies.length} label="Trial">
                      {(index) => <TrialResearchResults result={rankedTrials} activeIndex={index} />}
                    </ResultPages>
                    <Button type="button" variant="outline" onClick={onEditAnswers}>Edit trial answers</Button>
                  </>
                )}
              </>
            ) : <p className="text-sm text-muted-foreground">No clinical trials found for this search.</p>}
          </TabsContent>
        )}
        {drugResearch && (
          <TabsContent value="research" keepMounted className="break-words">
            <ResultPages count={drugResearch.topArticles.length} label="Study">
              {(index) => <DrugResearchResults result={drugResearch} activeIndex={index} />}
            </ResultPages>
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}
