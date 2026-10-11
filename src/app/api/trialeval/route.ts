import { z } from "zod";

const trialSchema = z.object({
  summary: z.string().trim().min(1),
  title: z.string().trim().min(1),
  condition: z.string().trim().min(1),
  trial_conditions: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
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

  const parsed = trialSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "summary, title, and condition must be non-empty strings." },
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
    const { evaluateTrial } = await import("@/lib/evaltools");
    const { summary, title, condition, trial_conditions } = parsed.data;
    const result = await evaluateTrial(summary, title, condition, trial_conditions);
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Trial evaluation failed:", error);
    return Response.json(
      { error: "Trial evaluation failed. Please retry." },
      { status: 502, headers },
    );
  }
}
