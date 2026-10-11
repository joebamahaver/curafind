
import "server-only";

import { Agent, McpClient } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function testMedicalAgent() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const model = new OpenAIModel({
    api: "chat",
    modelId: "openai/gpt-oss-20b",
    apiKey: process.env.GROQ_API_KEY,
    clientConfig: {
      baseURL: "https://api.groq.com/openai/v1",
    },
    params: {
      reasoning_effort: "low",
      parallel_tool_calls: false,
    },
  });

  const medicalMcp = new McpClient({
    transport: new StreamableHTTPClientTransport(
      new URL(
        process.env.MEDICAL_MCP_URL ??
          "http://127.0.0.1:3010/mcp"
      )
    ),
  });

  const agent = new Agent({
    model,
    tools: [medicalMcp],
  });

  const result = await agent.invoke(`
    Search clinical trials for cystic fibrosis.

    Identify one actual drug intervention listed in
    a clinical trial.

    Do not classify proteins, biomarkers, or biological
    targets as medications.

    Provide the drug name and its supporting NCT ID.

    If you cannot verify a drug intervention, say so.
  `);

  return result.lastMessage;
}
