import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { load, withEnv } from "./helpers/load.mjs";
import { trial, questions } from "./helpers/fixtures.mjs";

function request(body, raw = false) {
  return new Request("http://localhost/api/evaluation", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
}

async function expectResponse(response, status, expected) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  const body = await response.json();
  if (expected !== undefined) assert.deepEqual(body, expected);
  return body;
}

const answers = [{ question: "  Age?  ", answer: 25 }, { question: "Prior?", answer: false }];
const normalizedAnswers = [{ question: "Age?", answer: 25 }, { question: "Prior?", answer: false }];
const prepared = { trialSums: [trial()], questions };
const combinedAnswers = questions.map(({ id, question, type }) => ({ id, question, answer: type === "number" ? 25 : type === "yes-no" ? false : "" }));
const endpoints = [
  {
    path: "trialeval", evaluator: "evaluateTrial",
    input: { summary: "  Summary  ", title: "  Title  ", condition: "  Condition  " },
    args: ["Summary", "Title", "Condition", []],
    result: { applicableness: 80 }, response: { applicableness: 80 },
  },
  {
    path: "criterionfinder", evaluator: "criterionFinder",
    input: { criterion: "  Criteria  ", condition: "  Condition  " },
    args: ["Criteria", "Condition"],
    result: { questions }, response: { questions },
  },
  {
    path: "eligibility", evaluator: "evaluateEligibility",
    input: { answers, condition: "  Condition  ", criterion: "  Criteria  " },
    args: [normalizedAnswers, "Condition", "Criteria"],
    result: false, response: { eligible: false },
  },
  {
    path: "ranktrials", evaluator: "rankTrials",
    input: { answers, condition: "  Condition  ", trials: [trial()] },
    args: [normalizedAnswers, "Condition", [trial()]],
    result: [{ rank: 1, explanation: "Potential fit", treatment: "Example therapy", trial: trial() }],
    response: { trials: [{ rank: 1, explanation: "Potential fit", treatment: "Example therapy", trial: trial() }] },
  },
  {
    path: "trials/rank", evaluator: "evaluateEligibilityAndRankTrials",
    input: { condition: "  Condition  ", prepared_trials: prepared, answers: combinedAnswers },
    args: [prepared, combinedAnswers, "Condition"],
    result: { studies: [], evaluatedCount: 1, excludedCount: 1 },
    response: { studies: [], evaluatedCount: 1, excludedCount: 1 },
  },
];

function route(endpoint, evaluate) {
  const moduleId = endpoint.path === "trials/rank" ? "@/lib/trial-workflow" : "@/lib/evaltools";
  return load(`src/app/api/${endpoint.path}/route.ts`, { [moduleId]: { [endpoint.evaluator]: evaluate } });
}

for (const endpoint of endpoints) {
  test(`POST /api/${endpoint.path} validates and normalizes input and returns its public shape`, async () => {
    await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
      const req = request(endpoint.input);
      const calls = [];
      const { POST } = route(endpoint, async (...args) => { calls.push(args); return endpoint.result; });
      await expectResponse(await POST(req), 200, endpoint.response);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].slice(0, endpoint.args.length), endpoint.args);
      if (endpoint.path === "trialeval") assert.equal(calls[0][4].signal, req.signal);
      if (endpoint.path === "eligibility") assert.equal(calls[0][3].signal, req.signal);
      if (endpoint.path === "trials/rank") assert.equal(calls[0][3].signal, req.signal);
    });
  });

  test(`POST /api/${endpoint.path} rejects malformed JSON and invalid input before checking credentials`, async () => {
    await withEnv({ GROQ_API_KEY: undefined }, async () => {
      const { POST } = route(endpoint, () => assert.fail("Invalid requests must not invoke evaluation"));
      await expectResponse(await POST(request("{", true)), 400, { error: "Request body must be valid JSON." });
      for (const input of [null, [], {}, { ...endpoint.input, condition: "  " }, { ...endpoint.input, condition: 42 }]) {
        const body = await expectResponse(await POST(request(input)), 400);
        assert.equal(typeof body.error, "string");
      }
    });
  });

  test(`POST /api/${endpoint.path} applies credentials only to cloud-dependent paths`, async () => {
    for (const key of [undefined, ""]) {
      await withEnv({ GROQ_API_KEY: key }, async () => {
        const local = endpoint.path === "trialeval" || endpoint.path === "eligibility";
        const { POST } = route(endpoint, () => {
          if (!local) assert.fail("Missing cloud credentials must not invoke evaluation");
          return endpoint.result;
        });
        await expectResponse(await POST(request(endpoint.input)), local ? 200 : 500,
          local ? endpoint.response : { error: "GROQ_API_KEY is not configured." });
      });
    }
  });

  test(`POST /api/${endpoint.path} maps evaluator failures to a retryable 502 without exposing details`, async t => {
    t.mock.method(console, "error", () => {});
    await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
      const { POST } = route(endpoint, () => { throw new Error("private provider diagnostic"); });
      await expectResponse(await POST(request(endpoint.input)), 502, {
        error: endpoint.path === "trialeval" ? "Trial evaluation failed. Please retry." : "Evaluation failed. Please retry.",
      });
    });
  });
}

test("trial endpoint forwards explicit trial conditions and rejects malformed arrays", async () => {
  const endpoint = endpoints[0];
  await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
    const calls = [];
    const { POST } = route(endpoint, async (...args) => { calls.push(args); return endpoint.result; });
    await expectResponse(await POST(request({ ...endpoint.input, trial_conditions: ["A", "B"] })), 200);
    assert.deepEqual(calls[0][3], ["A", "B"]);
    for (const trial_conditions of ["A", [1], null]) {
      await expectResponse(await POST(request({ ...endpoint.input, trial_conditions })), 400);
    }
    assert.equal(calls.length, 1);
  });
});

test("standalone eligibility accepts all supported answer values, including no answers", async () => {
  const endpoint = endpoints[2];
  await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
    const { POST } = route(endpoint, async received => {
      assert.deepEqual(received.map(item => item.answer), ["", 0, false, null]);
      return true;
    });
    await expectResponse(await POST(request({ ...endpoint.input, answers: ["", 0, false, null].map(answer => ({ question: "Q", answer })) })), 200, { eligible: true });
    const empty = route(endpoint, async received => { assert.deepEqual(received, []); return true; });
    await expectResponse(await empty.POST(request({ ...endpoint.input, answers: [] })), 200, { eligible: true });
  });
});

test("standalone eligibility and ranking reject blank questions and unsupported answer values", async () => {
  await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
    for (const endpoint of [endpoints[2], endpoints[3]]) {
      const { POST } = route(endpoint, () => assert.fail("Invalid answers must not invoke evaluation"));
      for (const answers of [[{ question: " ", answer: null }], [{ question: "Q", answer: {} }], [{ question: "Q", answer: [] }], [{ question: "Q" }]]) {
        await expectResponse(await POST(request({ ...endpoint.input, answers })), 400);
      }
    }
  });
});

test("ranking rejects duplicate IDs and invalid trial metadata before inference", async () => {
  const endpoint = endpoints[3];
  await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
    const { POST } = route(endpoint, () => assert.fail("Invalid trials must not invoke evaluation"));
    for (const trials of [[trial(), trial()], [trial("", {})], [trial("A", { applicableness: 101 })], [trial("A", { eligibility: {} })]]) {
      await expectResponse(await POST(request({ ...endpoint.input, trials })), 400);
    }
  });
});

test("ranking keeps extra top-level and nested metadata through validation", async () => {
  const endpoint = endpoints[3];
  const enriched = trial("A", {
    source: { retained: true },
    eligibility: { ...trial().eligibility, healthyVolunteers: false },
    interventions: [{ ...trial().interventions[0], description: "Full description" }],
    locations: [{ ...trial().locations[0], contact: "Study team" }],
  });
  await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
    const { POST } = route(endpoint, async (_answers, _condition, trials) => {
      assert.deepEqual(trials, [enriched]);
      return [{ rank: 1, explanation: "Potential fit", treatment: "Example therapy", trial: trials[0] }];
    });
    await expectResponse(await POST(request({ ...endpoint.input, trials: [enriched] })), 200, { trials: [{ rank: 1, explanation: "Potential fit", treatment: "Example therapy", trial: enriched }] });
  });
});

test("combined ranking requires unique IDs and answers matching prepared question types", async () => {
  const endpoint = endpoints[4];
  const invalid = [
    { prepared_trials: { ...prepared, trialSums: [trial(), trial()] } },
    { prepared_trials: { ...prepared, questions: [questions[0], questions[0]] } },
    { prepared_trials: { studies: [trial()], questions } },
    { answers: [combinedAnswers[0], combinedAnswers[0]] },
    { answers: [{ id: "unknown", question: "Q", answer: null }] },
    { answers: [{ ...combinedAnswers[0], answer: "25" }] },
    { answers: [{ ...combinedAnswers[1], answer: "false" }] },
    { answers: [{ ...combinedAnswers[2], answer: false }] },
    { condition: "x".repeat(201) },
  ];
  await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
    const { POST } = route(endpoint, () => assert.fail("Invalid prepared answers must not invoke evaluation"));
    for (const overrides of invalid) await expectResponse(await POST(request({ ...endpoint.input, ...overrides })), 400);
  });
});

test("combined ranking accepts omitted answers and null for each question type", async () => {
  const endpoint = endpoints[4];
  await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
    for (const answers of [[], combinedAnswers.map(answer => ({ ...answer, answer: null }))]) {
      const { POST } = route(endpoint, async (_prepared, received) => {
        assert.deepEqual(received, answers);
        return endpoint.result;
      });
      await expectResponse(await POST(request({ ...endpoint.input, answers })), 200, endpoint.response);
    }
  });
});

test("shared evaluation response passes schema-transformed input to its evaluator", async () => {
  const { evaluationResponse } = load("src/lib/evaluation-api.ts");
  await withEnv({ GROQ_API_KEY: "test-key" }, async () => {
    const schema = z.object({ count: z.string().transform(Number) });
    const response = await evaluationResponse(request({ count: "3", ignored: true }), schema, async input => {
      assert.deepEqual(input, { count: 3 });
      return { count: input.count };
    });
    await expectResponse(response, 200, { count: 3 });
  });
});

test("combined ranking returns 200 with every eligible trial when the model repeatedly returns an invalid list", async t => {
  t.mock.method(console, "warn", () => {});
  await withEnv({ GROQ_API_KEY: "test-key", CEREBRAS_API_KEY: undefined }, async () => {
    let rankingCalls = 0;
    const eligibilityCalls = [];
    class MockModel {
      constructor(config) { this.config = config; }
      getConfig() { return this.config; }
    }
    class MockAgent {
      async invoke(payload) {
        rankingCalls++;
        assert.deepEqual(JSON.parse(payload).trials.map(({ id }) => id), ["A", "B"]);
        return { structuredOutput: { trials: [{ trialId: "C", explanation: "Invalid ranking", treatment: "Invented therapy" }] } };
      }
    }
    const { POST } = load("src/app/api/trials/rank/route.ts", {
      "@strands-agents/sdk": { Agent: MockAgent },
      "@strands-agents/sdk/models/openai": { OpenAIModel: MockModel },
      "@strands-agents/sdk/models/google": { GoogleModel: MockModel },
      "./local-decision-model": { createLocalDecisionModel: () => ({ invoke: async (state, _questions, options) => {
        assert.equal(options.signal, req.signal);
        eligibilityCalls.push(state.criterion);
        return { eligible: state.criterion.startsWith("Trial: C\n") ? 0 : 1 };
      } }) },
    });
    const trials = [trial("A", { applicableness: 60 }), trial("B", { applicableness: 90 }), trial("C", { applicableness: 100 })];
    const req = request({ condition: "Condition", prepared_trials: { trialSums: trials, questions }, answers: [] });
    const body = await expectResponse(await POST(req), 200);
    assert.equal(rankingCalls, 2);
    assert.equal(eligibilityCalls.length, 3);
    assert.equal(body.evaluatedCount, 3);
    assert.equal(body.excludedCount, 1);
    assert.deepEqual(body.studies.map(({ id, rank }) => [id, rank]), [["B", 1], ["A", 2]]);
    for (const study of body.studies) {
      const original = trials.find(({ id }) => id === study.id);
      assert.deepEqual(study.eligibility, original.eligibility);
      assert.deepEqual(study.interventions, original.interventions);
      assert.equal(study.treatment, "Example therapy");
      assert.match(study.explanation, /ordered by its applicability score/);
    }
  });
});
