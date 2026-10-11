import { z } from "zod";
import { evaluationResponse, trialSummarySchema } from "@/lib/evaluation-api";

const inputSchema = z.object({
  condition: z.string().trim().min(1).max(200),
  prepared_trials: z.object({
    studies: z.array(trialSummarySchema).refine(
      (trials) => new Set(trials.map(({ id }) => id)).size === trials.length,
      "Trial IDs must be unique.",
    ),
    questions: z.array(z.object({
      id: z.string().min(1),
      question: z.string().trim().min(1),
      type: z.enum(["number", "yes-no", "string"]),
    })).refine(
      (questions) => new Set(questions.map(({ id }) => id)).size === questions.length,
      "Question IDs must be unique.",
    ),
  }),
  answers: z.array(z.object({
    id: z.string().min(1),
    question: z.string(),
    answer: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })),
}).superRefine(({ prepared_trials, answers }, ctx) => {
  const questions = new Map(prepared_trials.questions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  answers.forEach(({ id, answer }, index) => {
    const question = questions.get(id);
    const expectedType = question?.type === "yes-no" ? "boolean" : question?.type;
    if (!question || seen.has(id) || (answer !== null && typeof answer !== expectedType)) {
      ctx.addIssue({ code: "custom", path: ["answers", index], message: "Answer must match a unique prepared question and its type." });
    }
    seen.add(id);
  });
});

export async function POST(request: Request) {
  return evaluationResponse(request, inputSchema, async (input) => {
    const { evaluateEligibilityAndRankTrials } = await import("@/lib/trial-workflow");
    return evaluateEligibilityAndRankTrials(input.prepared_trials, input.answers, input.condition, {
      signal: request.signal,
    });
  });
}
