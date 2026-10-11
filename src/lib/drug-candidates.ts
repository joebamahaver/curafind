
import {
  searchTrialsByDiagnosis,
  type TrialSummary,
} from "./clinical-trials";

export interface DrugCandidate {
  name: string;
  trialId: string;
  trialUrl: string;
  interventionType: string;
  status: string;
}

export async function getTrialDrugCandidates(
  diagnosis: string,
): Promise<DrugCandidate[]> {
  const result = await searchTrialsByDiagnosis({
    diagnosis,
    pageSize: 100,
    recruitment: "recruiting-or-upcoming",
  });

  const candidates: DrugCandidate[] = [];

  for (const trial of result.studies) {
    if (trial.studyType !== "INTERVENTIONAL") continue;

    for (const intervention of trial.interventions) {
      if (intervention.type !== "DRUG") continue;

      const name = intervention.name.trim();

      if (!name || /\bplacebo\b/i.test(name)) continue;

      candidates.push({
        name,
        trialId: trial.id,
        trialUrl: trial.url,
        interventionType: intervention.type,
        status: trial.status,
      });
    }
  }

  return candidates;
}
