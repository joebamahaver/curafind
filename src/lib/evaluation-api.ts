import { z } from "zod";

export const answersSchema = z.array(
  z.object({
    question: z.string().trim().min(1),
    answer: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
);

// Preserve extra metadata while checking the fields used by rankTrials.
export const trialSummarySchema = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  url: z.string(),
  status: z.string(),
  summary: z.string(),
  conditions: z.array(z.string()),
  phases: z.array(z.string()),
  studyType: z.string(),
  sponsor: z.string(),
  lastUpdated: z.string(),
  interventions: z.array(
    z.looseObject({ name: z.string(), type: z.string() }),
  ),
  eligibility: z.looseObject({
    minimumAge: z.string(),
    maximumAge: z.string(),
    sex: z.string(),
    criteria: z.string(),
  }),
  locations: z.array(
    z.looseObject({
      facility: z.string(),
      city: z.string(),
      state: z.string(),
      country: z.string(),
      status: z.string(),
    }),
  ),
});

export async function evaluationResponse<T>(
  request: Request,
  schema: z.ZodType<T>,
  evaluate: (input: T) => Promise<unknown>,
) {
  const headers = { "Cache-Control": "no-store" };
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body.", issues: parsed.error.issues },
      { status: 400, headers },
    );
  }

  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY is not configured." },
      { status: 500, headers },
    );
  }

  try {
    return Response.json(await evaluate(parsed.data), { headers });
  } catch (error) {
    console.error("Evaluation failed:", error);
    return Response.json(
      { error: "Evaluation failed. Please retry." },
      { status: 502, headers },
    );
  }
}
