import { connectMedicalMcp } from "../src/lib/medical-mcp.ts";
import { medicalModelContext } from "../src/lib/medical-model-context.ts";

const condition = process.argv.find(arg => arg.startsWith("--condition="))?.slice("--condition=".length) || "asthma";

const { client, tools } = await connectMedicalMcp();
try {
  console.log("MCP initialized:", client.serverVersion);
  console.log("Tools:", tools.map(tool => tool.name).join(", "));
  for (const [name, input] of [
    ["search-medical-literature", { query: "asthma randomized trial", max_results: 1 }],
    ["search-trials-with-eligibility", { condition: "asthma", zipCode: "64108", travelDistanceMiles: 100, limit: 2 }],
  ]) {
    const remote = tools.find(tool => tool.name === name);
    const result = await client.callTool(remote, input, { timeoutMs: 45000 });
    if (result.isError) throw new Error(name + ": " + JSON.stringify(result));
    const rawSize = JSON.stringify(result).length;
    const modelSize = JSON.stringify(medicalModelContext(name, result)).length;
    console.log(name + " succeeded:", { rawChars: rawSize, modelChars: modelSize,
      reduction: Math.round((1 - modelSize / rawSize) * 100) + "%" });
  }
} finally {
  await client.disconnect();
}

if (process.argv.includes("--agent")) {
  if (process.argv.includes("--debug")) {
    const { Agent, AfterToolCallEvent } = await import("@strands-agents/sdk");
    const originalInvoke = Agent.prototype.invoke;
    Agent.prototype.invoke = async function (...args) {
      this.addHook(AfterToolCallEvent, event => {
        console.log("Tool result:", event.toolUse.name, event.result.status, event.error?.message ?? "");
        if (event.result.status === "error" && event.toolUse.name === "ask_eligibility_questions") {
          console.log("Synthetic test question input:", JSON.stringify(event.toolUse.input));
        }
        if (event.result.status === "error" && event.toolUse.name === "strands_structured_output") {
          const report = event.toolUse.input;
          console.log("Synthetic test report citations:", JSON.stringify([...report.trials ?? [], ...report.research ?? []]
            .map(({ id, title, url, sourceIds }) => ({ id, title, url, sourceIds }))));
        }
      });
      return originalInvoke.apply(this, args);
    };
    const { OpenAIModel } = await import("@strands-agents/sdk/models/openai");
    const originalStream = OpenAIModel.prototype.stream;
    OpenAIModel.prototype.stream = async function* (messages, options) {
      // Exercise Strands' forced-output fallback after synthetic eligibility answers.
      if (process.argv.includes("--force-final") && !options?.toolChoice && JSON.stringify(messages).includes('"answer":')) {
        console.log("Simulating a plain-text completion to exercise forced final output.");
        yield { type: "modelMessageStartEvent", role: "assistant" };
        yield { type: "modelContentBlockStartEvent" };
        yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "Research complete." } };
        yield { type: "modelContentBlockStopEvent" };
        yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
        return;
      }
      console.log("Model turn:", JSON.stringify(messages.map(message => ({
        role: message.role,
        blocks: message.content.map(block => ({
          type: block.type, name: block.name, status: block.status,
          signed: Boolean(block.reasoningSignature),
        })),
      }))), "toolChoice:", options?.toolChoice);
      for await (const event of originalStream.call(this, messages, options)) {
        if (event.type === "modelMessageStopEvent") console.log("Model stop:", event.stopReason);
        yield event;
      }
    };
  }
  const { startMedicalResearch, resumeMedicalResearch } = await import("../src/lib/medical-research.ts");
  let result = await startMedicalResearch({
    condition, zipCode: "64108", travelDistanceMiles: 100,
    clinicalTrials: true, offLabelDrugsOrSupplements: true,
  });
  for (let round = 0; result.status === "questions" && round < 3; round++) {
    console.log("Agent paused with", result.questions.length, "questions.");
    // Synthetic test only: null explicitly represents unknown, never invented patient facts.
    result = await resumeMedicalResearch({
      sessionId: result.sessionId,
      answers: result.questions.map(question => ({ id: question.id, answer: null })),
    });
  }
  if (result.status !== "complete") throw new Error("Agent did not finish within three question rounds.");
  console.log("Agent completed:", result.report.trials.length, "trials,", result.report.research.length, "articles.");
  console.log("Source records retained:", result.sources.length);
}
