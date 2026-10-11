
import {
  searchDrugResearch,
  getDrugCandidates,
} from "@/lib/drug-research";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const diagnosis = searchParams.get("diagnosis")?.trim();

  if (!diagnosis) {
    return Response.json(
      { error: "Diagnosis is required" },
      { status: 400 }
    );
  }

  try {
    // Search PubMed for relevant articles
    const articleIds = await searchDrugResearch(diagnosis);

    // Extract indexed substances from those articles
    const candidates = await getDrugCandidates(articleIds);

    return Response.json({
      diagnosis,
      articlesSearched: articleIds.length,
      candidateCount: candidates.length,
      candidates,
    });
  } catch (error) {
    console.error("Drug candidate search failed:", error);

    return Response.json(
      { error: "Drug candidate search failed" },
      { status: 500 }
    );
  }
}
