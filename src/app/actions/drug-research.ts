"use server";

import { z } from "zod";
import {
  searchDrugResearch,
  getArticleDetails,
  readPubMedArticles,
} from "@/lib/drug-research";
import type { DrugEvaluationActionResult } from "@/lib/drug-evaluation-types";

function readLimit(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`${name} must be a positive whole number.`);
  }
  return limit;
}

export async function searchAndEvaluateDrugs(
  condition: string,
): Promise<DrugEvaluationActionResult> {
  const input = z.string().trim().min(1).max(200).safeParse(condition);
  if (!input.success) {
    return { success: false, error: "Enter a condition between 1 and 200 characters." };
  }

  let evaluationLimit: number;
  let displayLimit: number;
  try {
    evaluationLimit = readLimit("DRUG_EVAL_LIMIT", 5);
    displayLimit = readLimit("DRUG_DISPLAY_LIMIT", 2);
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
  try {
    // Use the same retrieval functions as /api/drugs, without fetching that route.
    const articleIds = await searchDrugResearch(input.data);
    const [articles, abstracts] = await Promise.all([
      getArticleDetails(articleIds),
      readPubMedArticles(articleIds),
    ]);
    const abstractsById = new Map(abstracts.map(article => [article.pmid, article.abstract]));
    const candidates = articles
      .map(article => ({ ...article, abstract: abstractsById.get(article.id) ?? null }))
      .filter((article): article is typeof article & { abstract: string } =>
        typeof article.abstract === "string" && article.abstract.trim().length > 0)
      .slice(0, evaluationLimit);

    // Apply the cap before sending stateless scoring requests to local Ollama.
    const evaluations = candidates.length > 0
      ? await Promise.allSettled(candidates.map(async article => {
          const { evaluateStudy } = await import("@/lib/evaltools");
          return { ...article, ...await evaluateStudy(input.data, article.abstract) };
        }))
      : [];
    const evaluated = evaluations.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    const failedCount = evaluations.length - evaluated.length;
    for (const result of evaluations) {
      if (result.status === "rejected") console.error("Study evaluation failed:", result.reason);
    }
    if (candidates.length > 0 && evaluated.length === 0) {
      return { success: false, error: "No studies could be evaluated. Please retry." };
    }
    evaluated.sort((a, b) => b.applicableness - a.applicableness || b.efficacy - a.efficacy);

    return {
      success: true,
      data: {
        diagnosis: input.data,
        articlesSearched: articleIds.length,
        evaluatedCount: evaluated.length,
        failedCount,
        evaluationLimit,
        displayLimit,
        articles: evaluated,
        topArticles: evaluated.slice(0, displayLimit),
      },
    };
  } catch (error) {
    console.error("Drug research evaluation failed:", error);
    return { success: false, error: "Drug research evaluation failed. Please retry." };
  }
}
