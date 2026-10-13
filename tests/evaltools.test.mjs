import test from "node:test";
import assert from "node:assert/strict";
import { load, withEnv } from "./helpers/load.mjs";
import { trial } from "./helpers/fixtures.mjs";

// Substitute the SDK boundary, keeping the real payload construction, schemas,
// retry logic and result mapping. No model constructor or call reaches a provider.
function setup(invoke) {
  const calls = [];
  class MockModel {
    constructor(config) { this.config = config; }
    getConfig() { return this.config; }
  }
  class MockGoogleModel extends MockModel {}
  class MockAgent {
    constructor(config) { this.config = config; }
    async invoke(payload) {
      const call = { agent: this, config: this.config, input: JSON.parse(payload) };
      calls.push(call);
      return { structuredOutput: await invoke(call) };
    }
  }
  return {
    ...load("src/lib/evaltools.ts", {
      "@strands-agents/sdk": { Agent: MockAgent },
      "@strands-agents/sdk/models/openai": { OpenAIModel: MockModel },
      "@strands-agents/sdk/models/google": { GoogleModel: MockGoogleModel },
    }),
    calls,
  };
}

const answers = [
  { question: "Age?", answer: 0 },
  { question: "Prior treatment?", answer: false },
  { question: "Name?", answer: "" },
  { question: "Unknown?", answer: null },
];
const score = { applicableness: 72 };
const study = { ...score, efficacy: 65, treatment: "Example therapy" };
const runTrial = api => api.evaluateTrial('Summary with "quotes"\nand a new line', "Title", "Condition", ["A", "B"]);

test("trial evaluation serializes supplied data and accepts score boundaries", async () => {
  const api = setup(() => ({ applicableness: 0, extra: "discard" }));
  assert.deepEqual(await runTrial(api), { applicableness: 0 });
  assert.deepEqual(api.calls[0].input, {
    summary: 'Summary with "quotes"\nand a new line', title: "Title", condition: "Condition",
    trial_conditions_str: "Trial ConditionsA,B",
  });
  assert.deepEqual(await runTrial(setup(() => ({ applicableness: 100 }))), { applicableness: 100 });
});

test("study evaluation preserves the treatment name or null and validates both scores", async () => {
  for (const treatment of ["Drug A + supplement B", null]) {
    const output = { applicableness: 100, efficacy: 0, treatment };
    const api = setup(() => output);
    assert.deepEqual(await api.evaluateStudy("Condition", "Abstract"), output);
    assert.deepEqual(api.calls[0].input, { condition: "Condition", abstract: "Abstract" });
  }
});

test("question generation preserves text and types and assigns unique UUIDs", async () => {
  const generated = ["number", "yes-no", "string"].map(type => ({ question: `Question ${type}?`, type }));
  const api = setup(() => ({ questions: generated }));
  const results = [await api.criterionFinder("Criteria", "Condition"), await api.criterionFinder("Criteria", "Condition")];
  const ids = results.flatMap(result => result.questions.map(question => question.id));
  assert.equal(new Set(ids).size, 6);
  for (const result of results) {
    assert.deepEqual(result.questions.map(({ question, type }) => ({ question, type })), generated);
    for (const { id } of result.questions) assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  }
  assert.deepEqual(api.calls[0].input, { criterion: "Criteria", condition: "Condition" });
  assert.deepEqual(await setup(() => ({ questions: [] })).criterionFinder("Criteria", "Condition"), { questions: [] });
});

test("eligibility returns a boolean and preserves false, zero, blank and unknown answers", async () => {
  for (const eligible of [true, false]) {
    const api = setup(() => ({ eligible }));
    assert.equal(await api.evaluateEligibility(answers, "Condition", "Criteria"), eligible);
    assert.deepEqual(api.calls[0].input, { answers, condition: "Condition", criterion: "Criteria" });
  }
});

const invalidOutputs = [
  ["trial: negative score", "evaluateTrial", { applicableness: -1 }],
  ["trial: score above 100", "evaluateTrial", { applicableness: 101 }],
  ["trial: numeric string", "evaluateTrial", { applicableness: "72" }],
  ["trial: missing output", "evaluateTrial", undefined],
  ["trial: non-finite score", "evaluateTrial", { applicableness: NaN }],
  ["study: negative efficacy", "evaluateStudy", { ...study, efficacy: -1 }],
  ["study: efficacy above 100", "evaluateStudy", { ...study, efficacy: 101 }],
  ["study: invalid applicability", "evaluateStudy", { ...study, applicableness: 101 }],
  ["study: empty treatment", "evaluateStudy", { ...study, treatment: "" }],
  ["study: missing treatment", "evaluateStudy", { applicableness: 50, efficacy: 50 }],
  ["questions: invalid type", "criterionFinder", { questions: [{ question: "Age?", type: "boolean" }] }],
  ["questions: missing text", "criterionFinder", { questions: [{ type: "number" }] }],
  ["questions: missing list", "criterionFinder", {}],
  ["eligibility: string boolean", "evaluateEligibility", { eligible: "false" }],
  ["eligibility: missing boolean", "evaluateEligibility", {}],
  ["ranking: missing explanation", "rankTrials", { trials: [{ trialId: "NCT00000001" }] }],
  ["ranking: missing list", "rankTrials", {}],
];
const invokeFunction = (api, name) => {
  if (name === "evaluateTrial") return runTrial(api);
  if (name === "evaluateStudy") return api.evaluateStudy("Condition", "Abstract");
  if (name === "criterionFinder") return api.criterionFinder("Criteria", "Condition");
  if (name === "evaluateEligibility") return api.evaluateEligibility(answers, "Condition", "Criteria");
  return api.rankTrials(answers, "Condition", [trial()]);
};
for (const [label, name, output] of invalidOutputs) {
  test(`structured output rejects ${label}`, async () => {
    const api = setup(() => output);
    await assert.rejects(invokeFunction(api, name), { name: "ZodError" });
    assert.equal(api.calls.length, 1, "invalid output must not trigger a provider retry");
  });
}

for (const name of ["evaluateTrial", "evaluateStudy", "criterionFinder", "evaluateEligibility", "rankTrials"]) {
  test(`${name} propagates provider errors`, async () => {
    const failure = new Error("Provider unavailable");
    const api = setup(() => { throw failure; });
    await assert.rejects(invokeFunction(api, name), error => error === failure);
    assert.equal(api.calls.length, 1);
  });
}

test("ranking uses returned order, one-based ranks and original metadata without mutation", async () => {
  const trials = [trial("A", { extra: { retained: true } }), trial("B")];
  const before = structuredClone(trials);
  const api = setup(() => ({ trials: [
    { trialId: "B", explanation: "Best potential fit" },
    { trialId: "A", explanation: "Unanswered requirements" },
  ] }));
  const result = await api.rankTrials(answers, "Condition", trials);
  assert.deepEqual(result, [
    { rank: 1, explanation: "Best potential fit", trial: trials[1] },
    { rank: 2, explanation: "Unanswered requirements", trial: trials[0] },
  ]);
  assert.equal(result[1].trial, trials[0]);
  assert.deepEqual(trials, before);
  assert.deepEqual(api.calls[0].input, { answers, condition: "Condition", trials });
});

for (const [label, ids, message] of [
  ["omitted", ["A"], /every trial exactly once/],
  ["duplicate", ["A", "A"], /every trial exactly once/],
  ["extra", ["A", "B", "C"], /every trial exactly once/],
  ["unknown", ["A", "C"], /unknown trial ID/],
]) {
  test(`ranking rejects ${label} trial IDs`, async () => {
    const api = setup(() => ({ trials: ids.map(trialId => ({ trialId, explanation: "Reason" })) }));
    await assert.rejects(api.rankTrials([], "Condition", [trial("A"), trial("B")]), message);
  });
}

test("empty ranking skips inference", async () => {
  const api = setup(() => assert.fail("Empty trials must not invoke an agent"));
  assert.deepEqual(await api.rankTrials([], "Condition", []), []);
  assert.equal(api.calls.length, 0);
});

test("without Cerebras credentials model selection rotates Groq and Google with fresh agents", async () => {
  await withEnv({ CEREBRAS_API_KEY: undefined }, async () => {
    const api = setup(() => score);
    await Promise.all(Array.from({ length: 4 }, () => runTrial(api)));
    assert.deepEqual(api.calls.map(call => call.config.model.getConfig().modelId), [
      "openai/gpt-oss-20b", "gemini-3.1-flash-lite", "openai/gpt-oss-20b", "gemini-3.1-flash-lite",
    ]);
    assert.equal(new Set(api.calls.map(call => call.agent)).size, 4);
  });
});

test("question generation uses Google without consuming the shared rotation", async () => {
  await withEnv({ CEREBRAS_API_KEY: undefined }, async () => {
    const api = setup(({ input }) => input.criterion !== undefined ? { questions: [] } : score);
    await api.criterionFinder("Criteria", "Condition");
    await runTrial(api);
    assert.deepEqual(api.calls.map(call => call.config.model.getConfig().modelId), ["gemini-3.1-flash-lite", "openai/gpt-oss-20b"]);
  });
});

test("Groq incomplete-stream errors do not retry", async () => {
  const failure = new Error("Incomplete JSON segment at the end");
  const api = setup(() => { throw failure; });
  await assert.rejects(runTrial(api), error => error === failure);
  assert.equal(api.calls.length, 1);
});
