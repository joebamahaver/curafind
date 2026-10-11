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

export type TrialAnswer = {
  id: string;
  question: string;
  answer: string | number | boolean | null;
};

export type FinalTrialResult = {
  studies: RankedTrialSummary[];
  evaluatedCount: number;
  excludedCount: number;
};

function eligibilityText(trial: TrialSummary): string {
  return [
    `Trial: ${trial.id}`,
    `Minimum age: ${trial.eligibility.minimumAge || "Not provided"}`,
    `Maximum age: ${trial.eligibility.maximumAge || "Not provided"}`,
    `Sex: ${trial.eligibility.sex || "Not provided"}`,
    `Eligibility criteria: ${trial.eligibility.criteria || "Not provided"}`,
  ].join("\n");
}

export interface PreparedTrialSearchResult extends TrialSearchResult {
  studies: TrialSummary[];
  questions: Awaited<ReturnType<typeof criterionFinder>>["questions"];
}

/** Score and shortlist trials from one search page by applicability. */
export async function searchTrialsAndMakeQuestions(
  input: DiagnosisSearch,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<PreparedTrialSearchResult> {
  // Set topCount to null to use topPercentage instead.
  const topCount: number | null = 3;
  const topPercentage = 25;

  const trials = await searchTrialsByDiagnosis(input, options);

  const studies: TrialSummary[] = [];
  const concurrency = 4;

  // Each call gets a fresh agent and the next model in the existing pool.
  // Finish a batch before starting another to keep at most four evaluations active.
  for (let start = 0; start < trials.studies.length; start += concurrency) {
    options.signal?.throwIfAborted();
    const batch = trials.studies.slice(start, start + concurrency);
    const evaluated = await Promise.all(batch.map(async trial => {
      const result = await evaluateTrial(
        trial.summary,
        trial.title,
        input.diagnosis,
        trial.conditions,
      );
      return { ...trial, applicableness: result.applicableness };
    }));
    studies.push(...evaluated);
  }
  options.signal?.throwIfAborted();

  // sort by applicableness and take top 3 or top x%
  studies.sort((a, b) => b.applicableness - a.applicableness);
  const selectionCount =
    topCount ?? Math.ceil((studies.length * topPercentage) / 100);
  const applicable_trials = studies.slice(0, selectionCount);

  // concatenate criteria from applicable trials to create questions
  const combinedCriteria = applicable_trials
    .map(eligibilityText)
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


export async function evaluateEligibilityAndRankTrials(
  prepared_trials: Pick<PreparedTrialSearchResult, "studies" | "questions">,
  answers: TrialAnswer[],
  condition: string,
  options: { signal?: AbortSignal } = {},
): Promise<FinalTrialResult> {
  // Match answers to the prepared questions; absent answers stay unknown.
  const answersById = new Map(answers.map((answer) => [answer.id, answer.answer]));
  const questionAnswers = prepared_trials.questions.map(({ id, question }) => ({
    question,
    answer: answersById.get(id) ?? null,
  }));
  const eligibleTrials: TrialSummary[] = [];
  for (const trial of prepared_trials.studies) {
    options.signal?.throwIfAborted();
    const eligible = await evaluateEligibility(questionAnswers, condition, eligibilityText(trial));
    if (eligible) eligibleTrials.push(trial);
  }
  options.signal?.throwIfAborted();
  const ranked = eligibleTrials.length > 0
    ? await rankTrials(questionAnswers, condition, eligibleTrials)
    : [];
  return {
    studies: ranked.map(({ trial, rank, explanation }) => ({ ...trial, rank, explanation })),
    evaluatedCount: prepared_trials.studies.length,
    excludedCount: prepared_trials.studies.length - eligibleTrials.length,
  };
}
