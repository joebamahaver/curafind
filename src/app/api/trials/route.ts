import {
  parseDiagnosisSearch,
  TrialSearchError,
} from "@/lib/clinical-trials";
import { searchTrialsAndMakeQuestions } from "@/lib/trial-workflow";

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
    const result = await searchTrialsAndMakeQuestions(parseDiagnosisSearch(body), {
      signal: request.signal,
    });
    return Response.json(result, { headers });
  } catch (error) {
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
