import { z } from "zod";
import {
  answersSchema,
  evaluationResponse,
  trialSummarySchema,
} from "@/lib/evaluation-api";

const inputSchema = z.object({
  answers: answersSchema,
  condition: z.string().trim().min(1),
  trials: z.array(trialSummarySchema).refine(
    (trials) => new Set(trials.map((trial) => trial.id)).size === trials.length,
    { message: "Trial IDs must be unique." },
  ),
});

export async function POST(request: Request) {
  return evaluationResponse(request, inputSchema, async (input) => {
    const { rankTrials } = await import("@/lib/evaltools");
    const trials = await rankTrials(input.answers, input.condition, input.trials);
    return { trials };
  });
}
