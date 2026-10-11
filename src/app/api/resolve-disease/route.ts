import { NextRequest, NextResponse } from "next/server";
import { resolveDisease } from "@/lib/disease-resolver";

export async function GET(request: NextRequest) {
  const diagnosis = request.nextUrl.searchParams.get("diagnosis");

  if (!diagnosis) {
    return NextResponse.json(
      { error: "Missing diagnosis" },
      { status: 400 }
    );
  }

  try {
    const result = await resolveDisease(diagnosis);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Disease resolver error:", error);

    return NextResponse.json(
      { error: "Disease lookup failed" },
      { status: 500 }
    );
  }
}