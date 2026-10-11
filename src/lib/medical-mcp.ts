import { McpClient } from "@strands-agents/sdk";

export const MEDICAL_MCP_URL = process.env.MEDICAL_MCP_URL || "http://127.0.0.1:3100/mcp";
export const RESEARCH_TOOLS = [
  "search-trials-with-eligibility",
  "search-medical-literature",
  "get-article-details",
  "search-drugs",
  "search-drug-safety",
  "search-clinical-guidelines",
] as const;

export async function connectMedicalMcp() {
  const client = new McpClient({
    url: MEDICAL_MCP_URL,
    applicationName: "curafind",
    applicationVersion: "0.1.0",
    toolFilters: { allowed: [...RESEARCH_TOOLS] },
  });
  try {
    const tools = await client.listTools();
    for (const name of ["search-medical-literature", "get-article-details", "search-trials-with-eligibility"]) {
      if (!tools.some(tool => tool.name === name)) {
        throw new Error(`Medical MCP is missing ${name}. Use the Curafind container with its eligibility extension.`);
      }
    }
    return { client, tools };
  } catch (error) {
    try { await client.disconnect(); }
    catch (cleanupError) {
      console.warn("[medical-mcp] Cleanup failed:", cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
    }
    throw error;
  }
}
