"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { RequestForm, type SearchRequest } from "@/components/request-form";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { requestTrialSearch } from "@/lib/trial-search-client";
import type { DiagnosisSearch, TrialSearchResult } from "@/lib/clinical-trials";

const readable = (value: string) => value.replaceAll("_", " ").toLowerCase();

/** Route selected search options to the available retrieval services. */
export function ClinicalTrialRequest() {
  const [result, setResult] = useState<TrialSearchResult | null>(null);
  const [query, setQuery] = useState<DiagnosisSearch | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const pageController = useRef<AbortController | null>(null);

  useEffect(() => () => pageController.current?.abort(), []);

  function resetResults() {
    pageController.current?.abort();
    pageController.current = null;
    setLoadingMore(false);
    setPageError("");
    setResult(null);
    setQuery(null);
  }

  async function search(request: SearchRequest, signal: AbortSignal) {
    resetResults();
    if (!request.clinicalTrials) {
      throw new Error("Off-label drug or supplement search is not available yet. Select Clinical trials to search for studies.");
    }
    const searchQuery: DiagnosisSearch = { diagnosis: request.condition, recruitment: "all", pageSize: 10 };
    const data = await requestTrialSearch(searchQuery, signal);
    // A cancelled request must not replace a later search, even if fetch already resolved.
    if (signal.aborted) return;
    setQuery(searchQuery);
    setResult(data);
  }

  async function loadMore() {
    if (!query || !result?.nextPageToken || pageController.current) return;
    const controller = new AbortController();
    pageController.current = controller;
    setLoadingMore(true);
    setPageError("");
    try {
      const data = await requestTrialSearch({ ...query, pageToken: result.nextPageToken }, controller.signal);
      if (controller.signal.aborted) return;
      setResult((previous) => previous ? {
        ...data,
        totalCount: previous.totalCount ?? data.totalCount,
        studies: [...previous.studies, ...data.studies.filter((study) => !previous.studies.some((existing) => existing.id === study.id))],
      } : previous);
    } catch (error) {
      if (!controller.signal.aborted) setPageError(error instanceof Error ? error.message : "Could not load more studies. Please retry.");
    } finally {
      if (pageController.current === controller) {
        pageController.current = null;
        setLoadingMore(false);
      }
    }
  }

  return <RequestForm onSubmit={search} onEdit={resetResults} completedContent={result && (
    <section aria-label="Clinical trial results">
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {result.studies.length} studies loaded{result.totalCount !== undefined ? ` of ${result.totalCount.toLocaleString()} matches` : ""}.
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Results from ClinicalTrials.gov include all recruitment statuses. A diagnosis match does not confirm eligibility; review each study’s criteria with its study team.</p>
      {result.studies.length === 0 && <p className="my-6 text-sm">{result.nextPageToken ? "No studies on this page. Load more to continue." : "No studies found. Try a broader condition or a different name for your diagnosis."}</p>}
      <div className="mt-6 space-y-5">
        {result.studies.map((study) => <article key={study.id} className="rounded-xl border border-border p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="rounded bg-muted px-2 py-1 capitalize">{readable(study.status)}</span><span>{study.id}</span></div>
          <h3 className="mt-3 text-base leading-6 font-medium"><a href={study.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{study.title}<ArrowUpRight aria-hidden="true" className="ml-1 inline size-4" /></a></h3>
          <p className="mt-3 line-clamp-4 text-sm leading-6 text-muted-foreground">{study.summary || "No summary provided."}</p>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium">Study details and eligibility</summary>
            <div className="mt-3 space-y-3 text-xs leading-6 text-muted-foreground">
              <p className="whitespace-pre-line">{study.summary}</p>
              <p><strong>Conditions:</strong> {study.conditions.join(", ") || "Not provided"}</p>
              <p><strong>Type / phase:</strong> {[study.studyType, ...study.phases].filter(Boolean).map(readable).join(" · ") || "Not provided"}</p>
              <p><strong>Sponsor:</strong> {study.sponsor || "Not provided"}</p>
              <p><strong>Age:</strong> {study.eligibility.minimumAge || "Minimum not provided"} – {study.eligibility.maximumAge || "Maximum not provided"}</p>
              <p><strong>Sex:</strong> {study.eligibility.sex || "Not provided"}</p>
              <p className="whitespace-pre-wrap">{study.eligibility.criteria || "Eligibility criteria not provided."}</p>
              <p><strong>Locations:</strong> {Array.from(new Set(study.locations.map((location) => [location.city, location.state, location.country].filter(Boolean).join(", ")).filter(Boolean))).join("; ") || "Not provided"}</p>
              <p><strong>Last updated:</strong> {study.lastUpdated || "Not provided"}</p>
            </div>
          </details>
        </article>)}
      </div>
      {pageError && <p role="alert" className="mt-4 text-sm text-destructive">{pageError}</p>}
      {result.nextPageToken && <Button type="button" variant="outline" className="mt-5 w-full" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore && <Spinner />}{loadingMore ? "Loading more studies…" : "Load more studies"}</Button>}
    </section>
  )} />;
}
