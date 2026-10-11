import { z } from "zod";
import type { JSONValue } from "@strands-agents/sdk";

const text = z.string().nullish();
const siteSchema = z.object({
  facility: text, status: text, city: text, state: text, country: text,
  geoPoint: z.object({ lat: z.number(), lon: z.number() }).nullish(),
});
const trialPayloadSchema = z.object({
  studies: z.array(z.object({
    protocolSection: z.object({
      identificationModule: z.object({ nctId: z.string(), briefTitle: text, officialTitle: text }),
      statusModule: z.object({ overallStatus: text }).nullish(),
      descriptionModule: z.object({ briefSummary: text }).nullish(),
      conditionsModule: z.object({ conditions: z.array(z.string()).optional() }).nullish(),
      armsInterventionsModule: z.object({
        interventions: z.array(z.object({ type: text, name: text })).optional(),
      }).nullish(),
      // Retain ALL eligibility fields verbatim; do not truncate clinical requirements.
      eligibilityModule: z.record(z.string(), z.json()).nullish(),
      designModule: z.object({
        studyType: text, phases: z.array(z.string()).optional(),
        enrollmentInfo: z.object({ count: z.number().optional(), type: text }).nullish(),
        designInfo: z.object({ allocation: text, interventionModel: text, primaryPurpose: text,
          maskingInfo: z.object({ masking: text }).nullish() }).nullish(),
      }).nullish(),
      contactsLocationsModule: z.object({ locations: z.array(siteSchema).optional() }).nullish(),
    }),
  })),
  sourceUrls: z.array(z.string()).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number(),
    zipCode: z.string(), travelDistanceMiles: z.number() }).optional(),
  nextPageToken: z.string().nullable().optional(),
});
const mcpResponseSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
});

function milesBetween(lat: number, lon: number, origin: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const angle = Math.sin(radians(lat - origin.latitude) / 2) ** 2 +
    Math.cos(radians(origin.latitude)) * Math.cos(radians(lat)) *
    Math.sin(radians(lon - origin.longitude) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, angle)));
}

function eligibilityReferences(trialId: string, eligibility: Record<string, JSONValue>) {
  return Object.entries(eligibility).flatMap(([field, value]) => {
    const lines = field === "eligibilityCriteria" && typeof value === "string"
      ? value.split("\n") : [typeof value === "string" ? value : JSON.stringify(value)];
    return lines.map((text, index) => ({ id: `${trialId}:${field === "eligibilityCriteria" ? "c" : field}${index}`, field, text }));
  });
}

function readTrialPayload(contents: string[]) {
  try { return trialPayloadSchema.parse(JSON.parse(contents.join("\n"))); }
  catch { return undefined; }
}

/** Resolve the model's short reference into original criterion text on the server. */
export function resolveEligibilityCriterion(result: unknown, criterionId: string) {
  const response = mcpResponseSchema.safeParse(result);
  if (!response.success || response.data.isError) return undefined;
  const payload = readTrialPayload((response.data.content ?? [])
    .filter(content => content.type === "text" && content.text !== undefined).map(content => content.text!));
  if (!payload) return undefined;
  for (const { protocolSection: protocol } of payload.studies) {
    const reference = eligibilityReferences(protocol.identificationModule.nctId, protocol.eligibilityModule ?? {})
      .find(reference => reference.id === criterionId && reference.text.trim());
    if (reference) return reference.field === "eligibilityCriteria" ? reference.text : `${reference.field}: ${reference.text}`;
  }
  return undefined;
}

/** Application-owned projection. Original MCP responses stay untouched in sources. */
export function medicalModelContext(name: string, result: unknown): JSONValue {
  const response = mcpResponseSchema.safeParse(result);
  if (!response.success) return { isError: true, message: "The source returned an unsupported response format." };
  const contents = (response.data.content ?? [])
    .filter(content => content.type === "text" && content.text !== undefined)
    .map(content => content.text!);
  if (response.data.isError) return { isError: true, text: contents.join("\n") };

  if (name === "search-trials-with-eligibility") {
    const payload = readTrialPayload(contents);
    if (!payload) return { isError: true, message: "Trial records could not be read. Do not infer eligibility from missing data." };
    const trials = payload.studies.map(({ protocolSection: protocol }) => {
      const allSites = protocol.contactsLocationsModule?.locations ?? [];
      let unknownDistanceCount = 0;
      const sites = allSites.flatMap(site => {
        const distance = payload.location && site.geoPoint
          ? milesBetween(site.geoPoint.lat, site.geoPoint.lon, payload.location) : null;
        if (distance === null) { unknownDistanceCount++; return []; }
        if (distance > payload.location!.travelDistanceMiles) return [];
        return [{ facility: site.facility, status: site.status, city: site.city, state: site.state,
          country: site.country, distanceMiles: Math.round(distance * 10) / 10 }];
      });
      const id = protocol.identificationModule.nctId;
      return {
        id, title: protocol.identificationModule.briefTitle ?? protocol.identificationModule.officialTitle,
        url: payload.sourceUrls?.find(url => url === `https://clinicaltrials.gov/study/${id}`),
        status: protocol.statusModule?.overallStatus,
        summary: protocol.descriptionModule?.briefSummary,
        conditions: protocol.conditionsModule?.conditions,
        interventions: protocol.armsInterventionsModule?.interventions,
        eligibility: eligibilityReferences(id, protocol.eligibilityModule ?? {}),
        design: protocol.designModule,
        sites, siteCounts: { total: allSites.length, withinRadius: sites.length, unknownDistance: unknownDistanceCount },
      };
    });
    // Remove undefined fields so the SDK receives only serializable JSON values.
    return JSON.parse(JSON.stringify({ trials, location: payload.location, hasMore: Boolean(payload.nextPageToken) }));
  }

  if (name === "get-article-details") {
    // The abstract is complete. Attached article bodies can add thousands of irrelevant tokens.
    const parts = contents.map(content => {
      const fullText = content.search(/^\*\*Full Text:\*\*/m);
      return { text: fullText < 0 ? content : content.slice(0, fullText).trimEnd(),
        fullTextOmitted: fullText >= 0 };
    });
    return { isError: false, parts };
  }

  // PubMed, drug safety and guideline responses are already concise text summaries.
  // Drop transport metadata, non-text blocks and duplicate structuredContent.
  return { isError: false, text: contents.join("\n") };
}
