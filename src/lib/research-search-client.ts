import { searchMedicalResearch, answerMedicalQuestions } from "@/app/actions/medical-research";
import { medicalRequestSchema, type MedicalResearchResult, type TrialAnswer } from "./medical-research-types";

export type ResearchSearchResult = MedicalResearchResult;

export async function requestResearchSearch(input: unknown, signal?: AbortSignal): Promise<MedicalResearchResult> {
  signal?.throwIfAborted();
  const request = medicalRequestSchema.parse(input);
  const result = await searchMedicalResearch(request);
  signal?.throwIfAborted();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export async function requestMedicalAnswers(sessionId: string, answers: TrialAnswer[], signal?: AbortSignal): Promise<MedicalResearchResult> {
  signal?.throwIfAborted();
  const result = await answerMedicalQuestions({ sessionId, answers });
  signal?.throwIfAborted();
  if (!result.success) throw new Error(result.error);
  return result.data;
}
