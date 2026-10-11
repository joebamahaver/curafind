import { z } from "zod";
import { evaluationResponse } from "@/lib/evaluation-api";

const inputSchema = z.object({
  criterion: z.string().trim().min(1),
  condition: z.string().trim().min(1),
});

export async function POST(request: Request) {
  return evaluationResponse(request, inputSchema, async (input) => {
    const { criterionFinder } = await import("@/lib/evaltools");
    return criterionFinder(input.criterion, input.condition);
  });
}
