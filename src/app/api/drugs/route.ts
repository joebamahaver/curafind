
import { NextRequest, NextResponse } from "next/server";

import {
  searchDrugResearch,
  getArticleDetails,
  readPubMedArticles,
} from "@/lib/drug-research";

export async function GET(request: NextRequest) {
  try {
    const diagnosis = request.nextUrl.searchParams
      .get("diagnosis")
      ?.trim();

    if (!diagnosis) {
      return NextResponse.json(
        { error: "Diagnosis is required" },
        { status: 400 }
      );
    }

    const includeAbstracts =
      request.nextUrl.searchParams.get("includeAbstracts") === "true";

    const articleIds = await searchDrugResearch(diagnosis);
    const articles = await getArticleDetails(articleIds);

    if (!includeAbstracts) {
      return NextResponse.json({
        diagnosis,
        articles,
      });
    }

    const abstracts = await readPubMedArticles(
      articles.map((article) => article.id)
    );

    const abstractsById = new Map(
      abstracts.map((article) => [
        article.pmid,
        article.abstract,
      ])
    );

    const enrichedArticles = articles.map((article) => ({
      ...article,
      abstract: abstractsById.get(article.id) ?? null,
    }));

    return NextResponse.json({
      diagnosis,
      articles: enrichedArticles,
    });
  } catch (error) {
    console.error("Drug research API error:", error);

    return NextResponse.json(
      { error: "Failed to retrieve drug research" },
      { status: 500 }
    );
  }
}
