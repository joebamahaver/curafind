import { z } from "zod";
import { trialLocationSchema } from "./trial-location.ts";

export const medicalRequestSchema = z.object({
  condition: z.string().trim().min(1).max(200),
  zipCode: z.string().trim().default(""),
  travelDistanceMiles: z.number().nullable().default(null),
  clinicalTrials: z.boolean(),
  offLabelDrugsOrSupplements: z.boolean(),
}).superRefine((request, context) => {
  if (!request.clinicalTrials && !request.offLabelDrugsOrSupplements) {
    context.addIssue({ code: "custom", message: "Select at least one search option." });
  }
  if (request.clinicalTrials) {
    const location = trialLocationSchema.safeParse(request);
    if (!location.success) {
      for (const issue of location.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  }
});

export const questionSchema = z.object({
  id: z.string().min(1),
  question: z.string().trim().min(1).max(500),
  type: z.enum(["number", "yes-no", "string"]),
  criterion: z.string().min(1).max(12000),
  sourceIds: z.array(z.string()).min(1),
});
export const questionBatchSchema = z.object({
  questions: z.array(questionSchema.pick({ question: true, type: true }).extend({
    criterionIds: z.array(z.string().min(1)).min(1).max(8)
      .describe("Copy complete eligibility entry IDs, including the NCT prefix, e.g. NCT12345678:c3. The server supplies original criterion text and source citations."),
  })).min(1).max(12),
});
export const answerSchema = z.object({
  id: z.string().min(1),
  answer: z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]),
});
export const resumeSchema = z.object({
  sessionId: z.uuid(),
  answers: z.array(answerSchema).max(12),
});

const studySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.url().refine(value => value.startsWith("https://"), "Study URLs must use HTTPS."),
  abstract: z.string().nullable().describe("Verbatim available abstract or trial summary; null when unavailable."),
  treatment: z.string().nullable(),
  explanation: z.string().min(1),
  eligibility: z.enum(["potential-match", "uncertain", "not-applicable"]),
  uncertainties: z.array(z.string()),
  sourceIds: z.array(z.string()).min(1),
});
export const medicalReportSchema = z.object({
  summary: z.string().min(1),
  trials: z.array(studySchema).max(25),
  research: z.array(studySchema).max(20),
  limitations: z.array(z.string()),
});
// The model explains/ranks; the application supplies abstracts from retrieved records.
// Gemini rejects these nested array maxItems in forced function-calling mode.
// Keep the limits in medicalReportSchema, which validates the hydrated result.
export const medicalAgentReportSchema = medicalReportSchema.extend({
  trials: z.array(studySchema.omit({ abstract: true })).describe("Return at most 25 trials, within the configured search limit."),
  research: z.array(studySchema.omit({ abstract: true })).describe("Return at most 20 articles, within the configured search limit."),
});

export type MedicalRequest = z.infer<typeof medicalRequestSchema>;
export type EligibilityQuestion = z.infer<typeof questionSchema>;
export type TrialAnswer = z.infer<typeof answerSchema> & { question?: string };
export type MedicalReport = z.infer<typeof medicalReportSchema>;
export type MedicalStudy = MedicalReport["trials"][number];
export type SourceRecord = {
  id: string;
  tool: string;
  input: unknown;
  result: unknown;
};
export type MedicalResearchResult = {
  status: "questions";
  sessionId: string;
  questions: EligibilityQuestion[];
  sources: SourceRecord[];
} | {
  status: "complete";
  report: MedicalReport;
  sources: SourceRecord[];
};
export type MedicalActionResult =
  | { success: true; data: MedicalResearchResult }
  | { success: false; error: string };
