import { Agent } from "@strands-agents/sdk";
import { GoogleModel } from "@strands-agents/sdk/models/google";

import { TrialSummary } from "./clinical-trials";

// Reads GEMINI_API_KEY from the environment.
const model = new GoogleModel({ modelId: "gemini-3.8-flash" });
const agent = new Agent({ model });
const result = await agent.invoke("What is an agent harness, in one sentence?");
console.log(result.lastMessage);

export async function dummyRankApplicableness(
  trial: TrialSummary,
): Promise<void> {
  const randomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;
  trial.applicableness = randomInt(0, 100);
}
