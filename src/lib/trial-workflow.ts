import type {
  DiagnosisSearch,
  TrialSummary,
  TrialSearchResult,
} from "./clinical-trials";
import { searchTrialsByDiagnosis } from "./clinical-trials";
import {
  evaluateTrial,
  criterionFinder,
  evaluateEligibility,
  rankTrials,
} from "./evaltools";

export interface RankedTrialSummary extends TrialSummary {
  rank: number;
  explanation: string;
}

export interface RankedTrialSearchResult extends TrialSearchResult {
  studies: RankedTrialSummary[];
  questions: Awaited<ReturnType<typeof criterionFinder>>["questions"];
}

/** Score and shortlist trials from one search page by applicability. */
export async function searchTrialsAndMakeQuestions(
  input: DiagnosisSearch,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RankedTrialSearchResult> {
  // Set topCount to null to use topPercentage instead.
  const topCount: number | null = 3;
  const topPercentage = 25;

  const trials = await searchTrialsByDiagnosis(input, options);

  const studies = [...trials.studies];

  // evaluate each trial for applicable ness
  for (const trial of studies) {
    const result = await evaluateTrial(
      trial.summary,
      trial.title,
      input.diagnosis,
      trial.conditions,
    );
    trial.applicableness = result.applicableness;
  }

  // sort by applicableness and take top 3 or top x%
  studies.sort((a, b) => b.applicableness - a.applicableness);
  const selectionCount =
    topCount ?? Math.ceil((studies.length * topPercentage) / 100);
  const applicable_trials = studies.slice(0, selectionCount);

  // concatenate criteria from applicable trials to create questions
  const combinedCriteria = applicable_trials
    .map((trial) =>
      [
        `Trial: ${trial.id}`,
        `Minimum age: ${trial.eligibility.minimumAge || "Not provided"}`,
        `Maximum age: ${trial.eligibility.maximumAge || "Not provided"}`,
        `Sex: ${trial.eligibility.sex || "Not provided"}`,
        `Eligibility criteria: ${trial.eligibility.criteria || "Not provided"}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  const { questions } =
    applicable_trials.length > 0
      ? await criterionFinder(combinedCriteria, input.diagnosis)
      : { questions: [] };
  console.log(questions);

  return {
    ...trials,
    questions,
    studies: applicable_trials.map((trial, index) => ({
      ...trial,
      rank: index + 1,
      explanation: "",
    })),
  };
}
