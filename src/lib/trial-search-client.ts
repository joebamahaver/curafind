import type { TrialParams } from "./trial-evaluation-types";
import type { PreparedTrialSearchResult } from "./trial-workflow";

/** Browser adapter shared by the patient flow **/
export async function requestTrialSearch(
  input: TrialParams,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PreparedTrialSearchResult> {
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
  return payload as PreparedTrialSearchResult;
}
