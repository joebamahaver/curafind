import { ZodError } from "zod";
import { startMedicalResearch, resumeMedicalResearch } from "@/lib/medical-research";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers }); }
  try {
    const resume = body !== null && typeof body === "object" && "sessionId" in body;
    const data = await (resume ? resumeMedicalResearch(body, request.signal) : startMedicalResearch(body, request.signal));
    return Response.json(data, { headers });
  } catch (error) {
    console.error("[api/research] Failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Research failed." }, {
      status: error instanceof ZodError ? 400 : 502, headers,
    });
  }
}
