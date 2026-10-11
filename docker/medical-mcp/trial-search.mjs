import { z } from "zod";

async function json(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Medical source returned HTTP ${response.status}.`);
  return response.json();
}

/** Return full source records; questions require criteria absent from the upstream summary tool. */
export async function searchTrialsWithEligibility(input, fetcher = fetch) {
  const place = await json(`https://api.zippopotam.us/us/${input.zipCode}`, fetcher);
  const latitude = Number(place.places?.[0]?.latitude);
  const longitude = Number(place.places?.[0]?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("Could not resolve that U.S. ZIP code.");
  }
  const url = new URL("https://clinicaltrials.gov/api/v2/studies");
  url.searchParams.set("query.cond", input.condition);
  url.searchParams.set("filter.overallStatus", "RECRUITING,NOT_YET_RECRUITING");
  url.searchParams.set("filter.geo", `distance(${latitude},${longitude},${input.travelDistanceMiles}mi)`);
  url.searchParams.set("pageSize", String(input.limit));
  url.searchParams.set("format", "json");
  const result = await json(url, fetcher);
  if (!Array.isArray(result.studies)) throw new Error("Unexpected trial registry response.");
  return {
    studies: result.studies,
    nextPageToken: result.nextPageToken ?? null,
    requestUrl: url.toString(),
    location: { zipCode: input.zipCode, travelDistanceMiles: input.travelDistanceMiles, latitude, longitude },
    sourceUrls: result.studies.map(study =>
      `https://clinicaltrials.gov/study/${study.protocolSection.identificationModule.nctId}`),
  };
}

export function registerTrialSearch(server) {
  server.tool("search-trials-with-eligibility",
    "Search recruiting or upcoming ClinicalTrials.gov studies within a U.S. ZIP radius in miles. Returns full protocol records, including eligibility, study sites, summary, interventions, IDs, and source URLs. Use before asking eligibility questions.",
    {
      condition: z.string().trim().min(1).max(200),
      zipCode: z.string().regex(/^\d{5}$/),
      travelDistanceMiles: z.number().min(1).max(10000),
      limit: z.number().int().min(1).max(25).default(10),
    },
    async input => {
      try {
        const result = await searchTrialsWithEligibility(input);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
    });
}
