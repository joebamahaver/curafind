import { z } from "zod";
import { answersSchema, evaluationResponse } from "@/lib/evaluation-api";

const inputSchema = z.object({
  answers: answersSchema,
  condition: z.string().trim().min(1),
  criterion: z.string().trim().min(1),
});

export async function POST(request: Request) {
  return evaluationResponse(request, inputSchema, async (input) => {
    const { evaluateEligibility } = await import("@/lib/evaltools");
    const eligible = await evaluateEligibility(
      input.answers,
      input.condition,
      input.criterion,
      { signal: request.signal },
    );
    return { eligible };
  }, { requireGroqKey: false });
}
