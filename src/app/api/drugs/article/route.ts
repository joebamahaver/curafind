
import { NextResponse } from "next/server";
import { readPubMedArticle } from "@/lib/drug-research";

// API endpoint for retrieving an individual PubMed abstract
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pmid = searchParams.get("pmid");

  if (!pmid || !/^\d+$/.test(pmid)) {
    return NextResponse.json(
      { error: "A valid PMID is required" },
      { status: 400 }
    );
  }

  try {
    const article = await readPubMedArticle(pmid);
    return NextResponse.json(article);
  } catch (error) {
    console.error("PubMed article error:", error);

    return NextResponse.json(
      { error: "Unable to retrieve article" },
      { status: 502 }
    );
  }
}
