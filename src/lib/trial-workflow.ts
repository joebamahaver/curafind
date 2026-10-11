import type {
  DiagnosisSearch,
  TrialSummary,
  TrialSearchResult,
} from "./clinical-trials";
import { searchTrialsByDiagnosis, TrialSearchError } from "./clinical-trials";
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

function readTrialLimit(name: string, fallback: number, minimum: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < minimum || limit > 1000) {
    throw new TrialSearchError(`${name} must be a whole number from ${minimum} to 1000.`, 500);
  }
  return limit;
}

/** Score and shortlist trials from one search page by applicability. */
export async function searchTrialsAndMakeQuestions(
  input: DiagnosisSearch,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<PreparedTrialSearchResult> {
  const searchLimit = readTrialLimit("TRIAL_SEARCH_LIMIT", 10, 10);
  const shortlistLimit = readTrialLimit("TRIAL_SHORTLIST_LIMIT", 3, 1);

  // The server configuration controls retrieval, regardless of the caller's page size.
  const trials = await searchTrialsByDiagnosis({ ...input, pageSize: searchLimit }, options);

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

  // Keep up to the configured number of highest-scoring trials.
  studies.sort((a, b) => b.applicableness - a.applicableness);
  const applicable_trials = studies.slice(0, shortlistLimit);

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
