import type { SearchRequest } from "@/components/request-form";
import type { TrialSearchResult } from "./clinical-trials";
import { requestTrialSearch } from "./trial-search-client";
import { searchAndEvaluateDrugs } from "@/app/actions/drug-research";
import type { DrugResearchResult } from "./drug-evaluation-types";

export type { ResearchArticle } from "./drug-evaluation-types";

export type ResearchSearchResult = {
  clinicalTrials: TrialSearchResult | null;
  drugResearch: DrugResearchResult | null;
  errors?: { clinicalTrials?: string; drugResearch?: string };
};

export async function requestDrugResearch(
  condition: string,
  signal?: AbortSignal,
): Promise<NonNullable<ResearchSearchResult["drugResearch"]>> {
  signal?.throwIfAborted();
  // AbortSignal stays in the browser; Server Functions accept serializable inputs.
  const result = await searchAndEvaluateDrugs(condition);
  signal?.throwIfAborted();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

/** Keep the clinical trial and evaluated drug results in separate JSON fields. */
export async function requestResearchSearch(
  request: SearchRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ResearchSearchResult> {
  signal?.throwIfAborted();
  const condition = request.condition.trim();
  if (!condition) throw new Error("Enter a condition.");
  if (!request.clinicalTrials && !request.offLabelDrugsOrSupplements) {
    throw new Error("Select at least one search option.");
  }

  const [trialResult, drugResult] = await Promise.allSettled([
    request.clinicalTrials
      ? requestTrialSearch({
          diagnosis: condition,
          recruitment: "recruiting-or-upcoming",
          pageSize: 10,
        }, signal, fetcher)
      : null,
    request.offLabelDrugsOrSupplements
      ? requestDrugResearch(condition, signal)
      : null,
  ]);
  signal?.throwIfAborted();
  const clinicalTrials = trialResult.status === "fulfilled" ? trialResult.value : null;
  const drugResearch = drugResult.status === "fulfilled" ? drugResult.value : null;
  const errors: NonNullable<ResearchSearchResult["errors"]> = {};
  if (trialResult.status === "rejected") {
    errors.clinicalTrials = trialResult.reason instanceof Error
      ? trialResult.reason.message : "Clinical trial search failed.";
  }
  if (drugResult.status === "rejected") {
    errors.drugResearch = drugResult.reason instanceof Error
      ? drugResult.reason.message : "Drug research search failed.";
  }
  if (!clinicalTrials && !drugResearch) {
    throw new Error(Object.values(errors).join(" ") || "Search failed. Please retry.");
  }
  return {
    clinicalTrials,
    drugResearch,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };
}
