
import { NextRequest, NextResponse } from "next/server";
import { getTrialDrugCandidates } from "@/lib/drug-candidates";

export async function GET(request: NextRequest) {
  const diagnosis =
    request.nextUrl.searchParams.get("diagnosis");

  if (!diagnosis) {
    return NextResponse.json(
      { error: "Diagnosis required" },
      { status: 400 },
    );
  }

  try {
    const candidates = await getTrialDrugCandidates(diagnosis);

    return NextResponse.json({
      diagnosis,
      count: candidates.length,
      candidates,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Candidate extraction failed" },
      { status: 500 },
    );
  }
}
