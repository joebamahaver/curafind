export type ResearchArticle = {
  id: string;
  title: string;
  publicationDate: string;
  journal: string;
  url: string;
  abstract: string | null;
};

export type EvaluatedDrugArticle = ResearchArticle & {
  applicableness: number;
  drugName: string | null;
  efficacy: number;
};

export type DrugResearchResult = {
  diagnosis: string;
  articlesSearched: number;
  evaluatedCount: number;
  failedCount: number;
  evaluationLimit: number;
  displayLimit: number;
  articles: EvaluatedDrugArticle[];
  topArticles: EvaluatedDrugArticle[];
};

export type DrugEvaluationActionResult =
  | { success: true; data: DrugResearchResult }
  | { success: false; error: string };
