import {
  parseDiagnosisSearch,
  TrialSearchError,
} from "@/lib/clinical-trials";
import { searchTrialsAndMakeQuestions } from "@/lib/trial-workflow";
import { trialLocationSchema } from "@/lib/trial-location";

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
  try {
    const search = parseDiagnosisSearch(body);
    const location = trialLocationSchema.safeParse(search);
    if (!location.success) throw new TrialSearchError(location.error.issues[0].message, 400);
    const result = await searchTrialsAndMakeQuestions(search, {
      signal: request.signal,
    });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("[api/trials] failed:", error);
    return Response.json(
      {
        error:
          error instanceof TrialSearchError
            ? error.message
            : "Search could not be completed. Please retry.",
      },
      {
        status: error instanceof TrialSearchError ? error.status : 502,
        headers,
      },
    );
  }
}
