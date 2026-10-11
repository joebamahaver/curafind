"use server";

import { startMedicalResearch, resumeMedicalResearch } from "@/lib/medical-research";
import type { MedicalActionResult } from "@/lib/medical-research-types";

export async function searchMedicalResearch(input: unknown): Promise<MedicalActionResult> {
  try { return { success: true, data: await startMedicalResearch(input) }; }
  catch (error) {
    console.error("[medical-research] Search failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Medical research failed. Please retry." };
  }
}

export async function answerMedicalQuestions(input: unknown): Promise<MedicalActionResult> {
  try { return { success: true, data: await resumeMedicalResearch(input) }; }
  catch (error) {
    console.error("[medical-research] Resume failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Could not process answers. Please retry." };
  }
}
