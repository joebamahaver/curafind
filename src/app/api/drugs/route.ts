
import { NextResponse } from "next/server";
import {
  searchDrugResearch,
  getArticleDetails,
} from "@/lib/drug-research";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const diagnosis = searchParams.get("diagnosis");

  if (!diagnosis?.trim()) {
    return NextResponse.json(
      { error: "Diagnosis is required" },
      { status: 400 }
    );
  }

  try {
    const articleIds = await searchDrugResearch(diagnosis.trim());
    const articles = await getArticleDetails(articleIds);

    return NextResponse.json({
      diagnosis: diagnosis.trim(),
      articles: articles,
    });
  } catch (error) {
    console.error("Drug research error:", error);

    return NextResponse.json(
      { error: "Unable to retrieve research" },
      { status: 502 }
    );
  }
}
