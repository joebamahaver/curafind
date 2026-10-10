/** Framework-independent client for the ClinicalTrials.gov v2 studies API. */
export interface DiagnosisSearch {
  diagnosis: string;
  /** Stage/subtype text search, not an eligibility check. */
  keywords?: string;
  recruitment?: "recruiting" | "recruiting-or-upcoming";
  pageSize?: number;
  /** Opaque cursor; reuse the original search options for subsequent pages. */
  pageToken?: string;
}

export interface TrialSummary {
  id: string;
  title: string;
  url: string;
  status: string;
  summary: string;
  conditions: string[];
  phases: string[];
  studyType: string;
  sponsor: string;
  lastUpdated: string;
  interventions: { name: string; type: string }[];
  eligibility: {
    minimumAge: string;
    maximumAge: string;
    sex: string;
    criteria: string;
  };
  locations: {
    facility: string;
    city: string;
    state: string;
    country: string;
    status: string;
  }[];
}

export interface TrialSearchResult {
  studies: TrialSummary[];
  totalCount?: number;
  nextPageToken?: string;
  requestUrl: string;
}

export class TrialSearchError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "TrialSearchError";
    this.status = status;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function strings(value: unknown): string[] {
  return list(value).filter((v): v is string => typeof v === "string");
}

/** Runtime validation is also used at the HTTP boundary. Defaults include recruiting and upcoming studies. */
export function parseDiagnosisSearch(value: unknown): DiagnosisSearch {
  const input = record(value);
  const diagnosis = text(input.diagnosis).trim();
  if (!diagnosis || diagnosis.length > 500)
    throw new TrialSearchError(
      "Enter a diagnosis between 1 and 500 characters.",
      400,
    );
  if (
    input.keywords !== undefined &&
    (typeof input.keywords !== "string" || input.keywords.length > 500)
  ) {
    throw new TrialSearchError(
      "Additional keywords must be text, up to 500 characters.",
      400,
    );
  }
  const recruitment = input.recruitment ?? "recruiting-or-upcoming";
  if (
    recruitment !== "recruiting" &&
    recruitment !== "recruiting-or-upcoming"
  ) {
    throw new TrialSearchError("Choose a supported recruitment filter.", 400);
  }
  const pageSize = input.pageSize ?? 10;
  // Smaller than the API maximum to keep interactive responses manageable.
  if (
    typeof pageSize !== "number" ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new TrialSearchError(
      "Page size must be a whole number from 1 to 100.",
      400,
    );
  }
  if (
    input.pageToken !== undefined &&
    (typeof input.pageToken !== "string" ||
      !input.pageToken ||
      input.pageToken.length > 10000)
  ) {
    throw new TrialSearchError("Invalid page token. Start a new search.", 400);
  }
  return {
    diagnosis,
    keywords: text(input.keywords).trim(),
    recruitment,
    pageSize,
    pageToken: input.pageToken as string | undefined,
  };
}

export function buildClinicalTrialsUrl(input: DiagnosisSearch): URL {
  const search = parseDiagnosisSearch(input);
  const url = new URL("https://clinicaltrials.gov/api/v2/studies");
  url.searchParams.set("format", "json");
  url.searchParams.set("query.cond", search.diagnosis);
  if (search.keywords) url.searchParams.set("query.term", search.keywords);
  url.searchParams.set(
    "filter.overallStatus",
    search.recruitment === "recruiting"
      ? "RECRUITING"
      : "RECRUITING,NOT_YET_RECRUITING",
  );

  url.searchParams.set("sort", "@relevance");
  url.searchParams.set("pageSize", String(search.pageSize));
  url.searchParams.set("countTotal", "true");
  if (search.pageToken) url.searchParams.set("pageToken", search.pageToken);
  return url;
}

/** Optional modules are often absent, especially in observational studies. */
export function normalizeStudy(value: unknown): TrialSummary {
  const protocol = record(record(value).protocolSection);
  const identification = record(protocol.identificationModule);
  const id = text(identification.nctId);
  if (!/^NCT\d{8}$/.test(id))
    throw new TrialSearchError(
      "ClinicalTrials.gov returned an invalid study record.",
    );
  const status = record(protocol.statusModule);
  const design = record(protocol.designModule);
  const eligibility = record(protocol.eligibilityModule);
  return {
    id,
    title:
      text(identification.briefTitle) ||
      text(identification.officialTitle) ||
      id,
    url: `https://clinicaltrials.gov/study/${id}`,
    status: text(status.overallStatus) || "UNKNOWN",
    summary: text(record(protocol.descriptionModule).briefSummary),
    conditions: strings(record(protocol.conditionsModule).conditions),
    phases: strings(design.phases),
    studyType: text(design.studyType),
    sponsor: text(
      record(record(protocol.sponsorCollaboratorsModule).leadSponsor).name,
    ),
    lastUpdated: text(record(status.lastUpdatePostDateStruct).date),
    interventions: list(
      record(protocol.armsInterventionsModule).interventions,
    ).map((value) => {
      const item = record(value);
      return { name: text(item.name), type: text(item.type) };
    }),
    eligibility: {
      minimumAge: text(eligibility.minimumAge),
      maximumAge: text(eligibility.maximumAge),
      sex: text(eligibility.sex),
      criteria: text(eligibility.eligibilityCriteria),
    },
    locations: list(record(protocol.contactsLocationsModule).locations).map(
      (value) => {
        const item = record(value);
        return {
          facility: text(item.facility),
          city: text(item.city),
          state: text(item.state),
          country: text(item.country),
          status: text(item.status),
        };
      },
    ),
  };
}

/** Inject fetch for deterministic tests; no API key or Next.js dependency required. */
export async function searchTrialsByDiagnosis(
  input: DiagnosisSearch,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<TrialSearchResult> {
  const url = buildClinicalTrialsUrl(input);
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      if (response.status === 429)
        throw new TrialSearchError(
          "ClinicalTrials.gov is rate limiting requests. Wait a moment and retry.",
          429,
        );
      if (response.status === 400)
        throw new TrialSearchError(
          "ClinicalTrials.gov could not interpret this query or page token. Try simpler terms or start a new search.",
          400,
        );
      throw new TrialSearchError(
        "ClinicalTrials.gov is temporarily unavailable. Please retry.",
      );
    }
    const payload = record(await response.json());
    if (
      !Array.isArray(payload.studies) ||
      (payload.totalCount !== undefined &&
        (typeof payload.totalCount !== "number" ||
          !Number.isInteger(payload.totalCount) ||
          payload.totalCount < 0)) ||
      (payload.nextPageToken !== undefined &&
        (typeof payload.nextPageToken !== "string" || !payload.nextPageToken))
    ) {
      throw new TrialSearchError(
        "ClinicalTrials.gov returned an unexpected response.",
      );
    }
    return {
      studies: payload.studies.map(normalizeStudy),
      totalCount: payload.totalCount as number | undefined,
      nextPageToken: payload.nextPageToken as string | undefined,
      requestUrl: url.toString(),
    };
  } catch (error) {
    if (error instanceof TrialSearchError) throw error;
    if (options.signal?.aborted) throw error;
    if (timeout.aborted)
      throw new TrialSearchError(
        "ClinicalTrials.gov took too long to respond. Please retry.",
        504,
      );
    throw new TrialSearchError(
      "Could not read data from ClinicalTrials.gov. Please retry.",
    );
  }
}
