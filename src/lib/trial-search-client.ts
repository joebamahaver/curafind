import type { DiagnosisSearch, TrialSearchResult } from "./clinical-trials";

/** Browser adapter shared by the patient flow and the synthetic-input playground. */
export async function requestTrialSearch(
  input: DiagnosisSearch,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TrialSearchResult> {
  const response = await fetcher("/api/trials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "The search service returned an unreadable response. Please retry.",
    );
  }
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Search failed. Please retry.",
    );
  }
  if (!payload || !Array.isArray(payload.studies)) {
    throw new Error(
      "The search service returned an unexpected response. Please retry.",
    );
  }
  return payload as TrialSearchResult;
}
