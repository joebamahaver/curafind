
import { NextResponse } from "next/server";
import { testMedicalAgent } from "@/lib/strands";

export async function GET() {
  try {
    const result = await testMedicalAgent();

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Medical MCP test failed:", error);

    return NextResponse.json(
      {
        error: "Medical agent test failed",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
