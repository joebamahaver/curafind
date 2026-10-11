import { Agent } from "@strands-agents/sdk";
import { GoogleModel } from "@strands-agents/sdk/models/google";
import { z } from "zod";

import { vicort } from "./vicort";

const model = new GoogleModel({ modelId: "gemini-3.8-flash" });

const scoreSchema = z.object({
  applicableness: z.number().min(0).max(100)
    .describe("Applicability score from 0 to 100"),
});

export async function evaluateTrial(
  summary: string,
  title: string,
  condition: string,
) {
  const evaluator = new Agent({
    model,
    systemPrompt: `${vicort}\nEvaluate the supplied trial.`,
    structuredOutputSchema: scoreSchema,
  });

  const result = await evaluator.invoke(
    JSON.stringify({ summary, title, condition }),
  );

  return scoreSchema.parse(result.structuredOutput);
}

const criterionQuestions = z.object({
    questions: z.array(
      z.object({
        question: z.string(),
        type: z.enum(["number", "yes-no", "string"]),
      }),
    ),
  });

export async function criterionFinder(
    criterion: string,
    condition: string,
  ) {
    const evaluator = new Agent({
        model,
        systemPrompt: `
    Generate questions for the user based on the supplied eligibility criteria.
    
    - Ask clear, simple questions.
    - Combine duplicate questions.
    - Only ask about requirements present in the criteria.
    - Classify each question as number, yes-no, or string.
    - Do not evaluate eligibility or assume the user's answers.
    `,
        structuredOutputSchema: criterionQuestions,
      });
  
    const result = await evaluator.invoke(
      JSON.stringify({ criterion, condition }),
    );
  
    return criterionQuestions.parse(result.structuredOutput);
  }