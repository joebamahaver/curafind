import test from "node:test";
import assert from "node:assert/strict";
import { load, withEnv } from "./helpers/load.mjs";
import { trial } from "./helpers/fixtures.mjs";

// Run the real local adapter with mocked HTTP, and mock Strands for cloud calls.
function setup(invoke, { forbidCloud = false } = {}) {
  const calls = [];
  const { createLocalDecisionModel } = load("src/lib/local-decision-model.ts");
  class MockModel {
    constructor(config) {
      if (forbidCloud) assert.fail("Local evaluation must not construct a cloud model");
      this.config = config;
    }
    getConfig() { return this.config; }
  }
  class MockGoogleModel extends MockModel {}
  class MockAgent {
    constructor(config) { this.config = config; }
    async invoke(payload) {
      const call = { agent: this, config: this.config, input: JSON.parse(payload), transport: "strands" };
      calls.push(call);
      return { structuredOutput: await invoke(call) };
    }
  }
  return {
    ...load("src/lib/evaltools.ts", {
      "./local-decision-model": { createLocalDecisionModel: () => createLocalDecisionModel({
        baseUrl: "http://localhost:11434", modelId: "tev1:4b", timeoutMs: 1000,
        fetcher: async (url, options) => {
          const { state, questions, model } = JSON.parse(options.body);
          const call = { input: state, questions, model, options, url, transport: "decisions" };
          calls.push(call);
          const output = await invoke(call);
          return Response.json({ answers: output === undefined ? undefined : Object.fromEntries(
            Object.entries(questions).map(([name, question]) => [name, { type: question.type, [question.type]: output[name] }]),
          ) });
        },
      }) },
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
const score = { applicableness: 2.88 };
const study = { ...score, efficacy: 2.6 };
const runTrial = (api, options) => api.evaluateTrial('Summary with "quotes"\nand a new line', "Title", "Condition", ["A", "B"], options);

test("trial evaluation serializes supplied data and accepts score boundaries", async () => {
  const api = setup(() => ({ applicableness: 0, extra: "discard" }));
  assert.deepEqual(await runTrial(api), { applicableness: 0 });
  assert.deepEqual(api.calls[0].input, {
    summary: 'Summary with "quotes"\nand a new line', title: "Title", condition: "Condition",
    trial_conditions: ["A", "B"],
  });
  assert.deepEqual(await runTrial(setup(() => ({ applicableness: 4 }))), { applicableness: 100 });
});

test("study evaluation sends both score questions in one request without treatment extraction", async () => {
  const api = setup(() => ({ applicableness: 4, efficacy: 2 }));
  assert.deepEqual(await api.evaluateStudy("Condition", "Abstract"), { applicableness: 100, efficacy: 50 });
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0].input, { condition: "Condition", abstract: "Abstract" });
  assert.deepEqual(Object.keys(api.calls[0].questions), ["applicableness", "efficacy"]);
  assert.equal(api.calls[0].questions.efficacy.type, "score");
  assert.match(api.calls[0].questions.efficacy.criteria[0], /missing results/i);
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
  for (const [probability, eligible] of [[0, false], [0.49, false], [0.5, true], [0.9, true], [1, true]]) {
    const api = setup(() => ({ eligible: probability }));
    assert.equal(await api.evaluateEligibility(answers, "Condition", "Criteria"), eligible);
    assert.deepEqual(api.calls[0].input, { answers, condition: "Condition", criterion: "Criteria" });
  }
});

const invalidOutputs = [
  ["trial: negative score", "evaluateTrial", { applicableness: -1 }],
  ["trial: score above 100", "evaluateTrial", { applicableness: 4.01 }],
  ["trial: numeric string", "evaluateTrial", { applicableness: "2" }],
  ["trial: missing output", "evaluateTrial", undefined],
  ["trial: non-finite score", "evaluateTrial", { applicableness: NaN }],
  ["study: negative efficacy", "evaluateStudy", { ...study, efficacy: -1 }],
  ["study: efficacy above 100", "evaluateStudy", { ...study, efficacy: 4.01 }],
  ["study: invalid applicability", "evaluateStudy", { ...study, applicableness: 4.01 }],
  ["study: missing efficacy", "evaluateStudy", { applicableness: 2 }],
  ["questions: invalid type", "criterionFinder", { questions: [{ question: "Age?", type: "boolean" }] }],
  ["questions: missing text", "criterionFinder", { questions: [{ type: "number" }] }],
  ["questions: missing list", "criterionFinder", {}],
  ["eligibility: string boolean", "evaluateEligibility", { eligible: "false" }],
  ["eligibility: missing boolean", "evaluateEligibility", {}],
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
    { trialId: "B", explanation: "Best potential fit", treatment: "Example therapy" },
    { trialId: "A", explanation: "Unanswered requirements", treatment: null },
  ] }));
  const result = await api.rankTrials(answers, "Condition", trials);
  assert.deepEqual(result, [
    { rank: 1, explanation: "Best potential fit", treatment: "Example therapy", trial: trials[1] },
    { rank: 2, explanation: "Unanswered requirements", treatment: null, trial: trials[0] },
  ]);
  assert.equal(result[1].trial, trials[0]);
  assert.deepEqual(trials, before);
  assert.deepEqual(api.calls[0].input, { answers, condition: "Condition", trials });
  assert.match(api.calls[0].config.systemPrompt, /Extract the main treatment/);
});

for (const [label, ids] of [
  ["omitted", ["A"]],
  ["duplicate", ["A", "A"]],
  ["extra", ["A", "B", "C"]],
  ["unknown", ["A", "C"]],
]) {
  test(`ranking recovers from persistently ${label} trial IDs with a complete fallback`, async t => {
    t.mock.method(console, "warn", () => {});
    const api = setup(() => ({ trials: ids.map(trialId => ({ trialId, explanation: "Reason", treatment: null })) }));
    const trials = [trial("A", { applicableness: 60 }), trial("B", { applicableness: 90 })];
    const before = structuredClone(trials);
    const result = await api.rankTrials([], "Condition", trials);
    assert.equal(api.calls.length, 2, "invalid rankings should trigger exactly one correction attempt");
    assert.deepEqual(result.map(({ rank, trial }) => [rank, trial.id]), [[1, "B"], [2, "A"]]);
    assert.equal(result[0].trial, trials[1]);
    assert.equal(result[1].trial, trials[0]);
    assert.equal(result.every(item => item.explanation.includes("ordered by its applicability score")), true);
    assert.equal(result.every(item => item.treatment === "Example therapy"), true);
    assert.deepEqual(trials, before, "fallback must not mutate original trial metadata");
  });
}

test("ranking correction uses a fresh agent with the same model and unchanged input", async t => {
  t.mock.method(console, "warn", () => {});
  let attempt = 0;
  const api = setup(() => ({ trials: ++attempt === 1
    ? [{ trialId: "A", explanation: "Incomplete", treatment: null }]
    : [
      { trialId: "B", explanation: "Corrected best fit", treatment: "Drug B" },
      { trialId: "A", explanation: "Corrected next fit", treatment: null },
    ] }));
  const result = await api.rankTrials(answers, "Condition", [trial("A"), trial("B")]);
  assert.deepEqual(result.map(({ rank, explanation, treatment, trial }) => [rank, trial.id, explanation, treatment]), [
    [1, "B", "Corrected best fit", "Drug B"], [2, "A", "Corrected next fit", null],
  ]);
  assert.equal(api.calls.length, 2);
  assert.notEqual(api.calls[0].agent, api.calls[1].agent);
  assert.equal(api.calls[0].config.model, api.calls[1].config.model);
  assert.deepEqual(api.calls[0].input, api.calls[1].input);
  assert.match(api.calls[1].config.systemPrompt, /previous result failed validation/);
});

test("ranking schema constrains the number of entries and the allowed IDs per request", async () => {
  const api = setup(() => ({ trials: [
    { trialId: "A", explanation: "Reason", treatment: null },
    { trialId: "B", explanation: "Reason", treatment: null },
  ] }));
  await api.rankTrials([], "Condition", [trial("A"), trial("B")]);
  const schema = api.calls[0].config.structuredOutputSchema;
  const item = trialId => ({ trialId, explanation: "Reason", treatment: null });
  assert.equal(schema.safeParse({ trials: [item("A"), item("B")] }).success, true);
  assert.equal(schema.safeParse({ trials: [item("A")] }).success, false);
  assert.equal(schema.safeParse({ trials: [item("A"), item("C")] }).success, false);
});

for (const [label, output] of [
  ["missing explanation", { trials: [{ trialId: "A", treatment: null }] }],
  ["missing treatment", { trials: [{ trialId: "A", explanation: "Reason" }] }],
  ["empty treatment", { trials: [{ trialId: "A", explanation: "Reason", treatment: "" }] }],
  ["missing list", {}],
  ["missing output", undefined],
]) {
  test(`ranking handles ${label} after one correction attempt`, async t => {
    t.mock.method(console, "warn", () => {});
    const api = setup(() => output);
    const trials = [trial("A", { interventions: [] })];
    const result = await api.rankTrials([], "Condition", trials);
    assert.equal(api.calls.length, 2);
    assert.equal(result[0].trial, trials[0]);
    assert.equal(result[0].treatment, null);
    assert.match(result[0].explanation, /could not return a complete valid list/);
  });
}

test("fallback ties preserve input order and treatment names come only from original interventions", async t => {
  t.mock.method(console, "warn", () => {});
  const trials = [
    trial("A", { applicableness: 80, interventions: [{ name: " Drug A ", type: "DRUG" }, { name: "Drug A", type: "DRUG" }, { name: "Therapy B", type: "OTHER" }, { name: " ", type: "OTHER" }] }),
    trial("B", { applicableness: 80, interventions: [] }),
  ];
  const api = setup(() => ({ trials: [{ trialId: "unknown", explanation: "Invented", treatment: "Invented drug" }] }));
  const result = await api.rankTrials([], "Condition", trials);
  assert.deepEqual(result.map(item => item.trial.id), ["A", "B"]);
  assert.deepEqual(result.map(item => item.treatment), ["Drug A; Therapy B", null]);
  assert.equal(result.some(item => item.explanation === "Invented"), false);
});

test("duplicate input trial IDs are rejected before model invocation", async () => {
  const api = setup(() => assert.fail("Duplicate input IDs must not invoke an agent"));
  await assert.rejects(api.rankTrials([], "Condition", [trial("A"), trial("A")]), /Trial IDs must be unique/);
  assert.equal(api.calls.length, 0);
});

test("a provider failure during correction propagates rather than becoming a fallback", async t => {
  t.mock.method(console, "warn", () => {});
  const failure = new Error("Provider unavailable");
  let calls = 0;
  const api = setup(() => {
    if (++calls === 1) return { trials: [] };
    throw failure;
  });
  await assert.rejects(api.rankTrials([], "Condition", [trial()]), error => error === failure);
  assert.equal(api.calls.length, 2);
});

test("empty ranking skips inference", async () => {
  const api = setup(() => assert.fail("Empty trials must not invoke an agent"));
  assert.deepEqual(await api.rankTrials([], "Condition", []), []);
  assert.equal(api.calls.length, 0);
});

test("local evaluators work without cloud keys and do not consume the cloud ranking rotation", async () => {
  await withEnv({ GROQ_API_KEY: undefined, GEMINI_API_KEY: undefined, CEREBRAS_API_KEY: undefined }, async () => {
    const api = setup(({ transport, input }) => transport === "decisions"
      ? input.abstract ? { applicableness: 2, efficacy: 2 } : input.answers ? { eligible: 1 } : { applicableness: 2 }
      : { trials: [{ trialId: "NCT00000001", explanation: "Reason", treatment: null }] });
    await runTrial(api);
    await api.evaluateStudy("Condition", "Abstract");
    await api.evaluateEligibility([], "Condition", "Criteria");
    await api.rankTrials([], "Condition", [trial()]);
    assert.deepEqual(api.calls.map(call => call.transport), ["decisions", "decisions", "decisions", "strands"]);
    assert.equal(api.calls[3].config.model.getConfig().modelId, "openai/gpt-oss-20b");
  });
});

test("local evaluator cancellation propagates before HTTP dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  const api = setup(() => assert.fail("Cancelled evaluation must not call HTTP"));
  await assert.rejects(runTrial(api, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(api.evaluateStudy("Condition", "Abstract", { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(api.evaluateEligibility([], "Condition", "Criteria", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(api.calls.length, 0);
});

test("local functions never construct cloud models", async () => {
  const api = setup(({ input }) => input.abstract ? { applicableness: 2, efficacy: 2 } : input.answers ? { eligible: 1 } : score, { forbidCloud: true });
  await runTrial(api);
  await api.evaluateStudy("Condition", "Abstract");
  await api.evaluateEligibility([], "Condition", "Criteria");
  assert.equal(api.calls.every(call => call.transport === "decisions"), true);
});

test("real Strands adapters can be imported for local evaluation with no cloud credentials", async () => {
  const [sdk, openai, google] = await Promise.all([
    import("@strands-agents/sdk"),
    import("@strands-agents/sdk/models/openai"),
    import("@strands-agents/sdk/models/google"),
  ]);
  await withEnv({ GROQ_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined, CEREBRAS_API_KEY: undefined }, async () => {
    const api = load("src/lib/evaltools.ts", {
      "@strands-agents/sdk": sdk,
      "@strands-agents/sdk/models/openai": openai,
      "@strands-agents/sdk/models/google": google,
      "./local-decision-model": { createLocalDecisionModel: () => ({ invoke: async () => ({ applicableness: 2, efficacy: 1, eligible: 1 }) }) },
    });
    assert.deepEqual(await runTrial(api), { applicableness: 50 });
    assert.deepEqual(await api.evaluateStudy("Condition", "Abstract"), { applicableness: 50, efficacy: 25 });
    assert.equal(await api.evaluateEligibility([], "Condition", "Criteria"), true);
  });
});
