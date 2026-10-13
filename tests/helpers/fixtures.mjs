export function trial(id = "NCT00000001", overrides = {}) {
  return {
    id,
    title: `Trial ${id}`,
    url: `https://clinicaltrials.gov/study/${id}`,
    status: "RECRUITING",
    summary: "A study of an example therapy.",
    conditions: ["Example condition"],
    phases: ["PHASE2"],
    studyType: "INTERVENTIONAL",
    sponsor: "Example sponsor",
    lastUpdated: "2026-10-01",
    interventions: [{ name: "Example therapy", type: "DRUG" }],
    eligibility: { minimumAge: "18 Years", maximumAge: "65 Years", sex: "ALL", criteria: "Adults without prior treatment." },
    locations: [{ facility: "Example clinic", city: "Kansas City", state: "MO", country: "United States", status: "RECRUITING" }],
    applicableness: 80,
    ...overrides,
  };
}

export const questions = [
  { id: "age", question: "How old are you?", type: "number" },
  { id: "prior", question: "Have you had prior treatment?", type: "yes-no" },
  { id: "name", question: "What treatment did you receive?", type: "string" },
];
