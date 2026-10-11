export interface TrialParams {
  diagnosis: string;
  zipCode?: string;
  travelDistanceMiles?: number;
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
  applicableness: number;
}

export interface RankedTrialSummary extends TrialSummary {
  rank: number;
  explanation: string;
}

export interface TrialSearchResult {
  trialSums: TrialSummary[];
  totalCount?: number;
  nextPageToken?: string;
  requestUrl: string;
  locationFilter?: {
    zipCode: string;
    travelDistanceMiles: number;
    latitude: number;
    longitude: number;
    city: string;
    state: string;
  };
}

export type TrialAnswer = {
  id: string;
  question: string;
  answer: string | number | boolean | null;
};

export type FinalTrialResult = {
  studies: RankedTrialSummary[];
  evaluatedCount: number;
  excludedCount: number;
};
