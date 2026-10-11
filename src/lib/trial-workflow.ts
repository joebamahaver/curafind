import type {
  DiagnosisSearch,
  TrialSummary,
  TrialSearchResult,
} from "./clinical-trials";
import { searchTrialsByDiagnosis } from "./clinical-trials";

export interface RankedTrialSummary extends TrialSummary {
  rank: number;
  explanation: string;
}

export interface RankedTrialSearchResult extends TrialSearchResult {
  studies: RankedTrialSummary[];
}

/** Entry point for the trial workflow. Currently returns a random order per page. */
export async function searchAndRankTrials(
  input: DiagnosisSearch,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RankedTrialSearchResult> {
  const trials = await searchTrialsByDiagnosis(input, options);
  const studies = [...trials.studies];

  // Temporary Fisher–Yates shuffle; replace with evaluation and ranking later.
  for (let index = studies.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [studies[index], studies[randomIndex]] = [studies[randomIndex], studies[index]];
  }

  return {
    ...trials,
    studies: studies.map((trial, index) => ({
      ...trial,
      rank: index + 1,
      explanation: "",
    })),
  };
}
