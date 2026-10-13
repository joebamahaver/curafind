import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers/load.mjs";
import { trial, questions } from "./helpers/fixtures.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// These tests exercise default limits independently of local .env settings.
let previousLimits;
test.beforeEach(() => {
  previousLimits = [process.env.TRIAL_SEARCH_LIMIT, process.env.TRIAL_SHORTLIST_LIMIT];
  delete process.env.TRIAL_SEARCH_LIMIT;
  delete process.env.TRIAL_SHORTLIST_LIMIT;
});
test.afterEach(() => {
  ["TRIAL_SEARCH_LIMIT", "TRIAL_SHORTLIST_LIMIT"].forEach((key, index) => {
    if (previousLimits[index] === undefined) delete process.env[key];
    else process.env[key] = previousLimits[index];
  });
});

const input = { diagnosis: "Example condition", pageSize: 10 };
const scores = [12, 93, 23, 95, 61, 42, 97, 82, 75, 30];
function retrieval(count = 10) {
  return {
    trialSums: Array.from({ length: count }, (_, index) => ({
      id: `NCT${index}`, title: `Trial ${index}`, summary: `Summary ${index}`,
      conditions: [`Condition ${index}`], url: `https://example.com/${index}`,
      applicableness: 0,
      eligibility: { minimumAge: "18 Years", maximumAge: "65 Years", sex: "ALL", criteria: `Criteria ${index}` },
    })),
    totalCount: 100, nextPageToken: "next-page", requestUrl: "https://example.com/search",
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
}

function setup({ count = 10, evaluate, questions = async () => ({ questions: [] }) }) {
  const retrieved = retrieval(count);
  const workflow = load("src/lib/trial-workflow.ts", {
    "./clinical-trials": { searchTrialsByDiagnosis: async () => retrieved },
    "./evaltools": { evaluateTrial: evaluate, criterionFinder: questions },
  });
  return { ...workflow, retrieved };
}

test("trial scoring runs in batches of four, preserves IDs despite completion order, and asks about only the top three", async () => {
  const pending = new Map();
  const calls = [];
  const questionCalls = [];
  let active = 0;
  let peak = 0;
  const { searchTrialsAndMakeQuestions, retrieved } = setup({
    evaluate: async (summary, title, condition, conditions) => {
      const index = Number(title.split(" ")[1]);
      assert.equal(summary, `Summary ${index}`);
      assert.equal(condition, input.diagnosis);
      assert.deepEqual(conditions, [`Condition ${index}`]);
      calls.push(index);
      active++;
      peak = Math.max(peak, active);
      const result = deferred();
      pending.set(index, result);
      try { return await result.promise; }
      finally { active--; }
    },
    questions: async (criterion, condition) => {
      assert.equal(active, 0);
      questionCalls.push({ criterion, condition });
      return { questions: [{ id: "question-1", question: "How old are you?", type: "number" }] };
    },
  });
  const original = structuredClone(retrieved);
  const resultPromise = searchTrialsAndMakeQuestions(input);
  await flush();
  assert.deepEqual(calls, [0, 1, 2, 3]);
  assert.equal(active, 4);
  pending.get(3).resolve({ applicableness: scores[3] });
  await flush();
  assert.equal(calls.length, 4, "next batch must wait for every current evaluation");
  for (const index of [2, 1, 0]) pending.get(index).resolve({ applicableness: scores[index] });
  await flush();
  assert.deepEqual(calls, [0, 1, 2, 3, 4, 5, 6, 7]);
  for (const index of [7, 6, 5, 4]) pending.get(index).resolve({ applicableness: scores[index] });
  await flush();
  assert.deepEqual(calls, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const index of [9, 8]) pending.get(index).resolve({ applicableness: scores[index] });
  const result = await resultPromise;
  assert.equal(peak, 4);
  assert.deepEqual(result.trialSums.map(({ id, applicableness, rank }) => [id, applicableness, rank]), [
    ["NCT6", 97, 1], ["NCT3", 95, 2], ["NCT1", 93, 3],
  ]);
  assert.equal(result.trialSums[0].url, retrieved.trialSums[6].url);
  assert.equal(result.nextPageToken, retrieved.nextPageToken);
  assert.equal(result.totalCount, retrieved.totalCount);
  assert.deepEqual(retrieved, original, "scoring must not mutate retrieval data");
  assert.equal(questionCalls.length, 1);
  assert.equal(questionCalls[0].condition, input.diagnosis);
  assert.deepEqual([...questionCalls[0].criterion.matchAll(/Trial: (NCT\d+)/g)].map(match => match[1]), ["NCT6", "NCT3", "NCT1"]);
  assert.equal(result.questions[0].id, "question-1");
});

test("empty results skip inference and fewer than four trials are all evaluated", async () => {
  for (const count of [0, 1, 3]) {
    const calls = [];
    let questionCalls = 0;
    const { searchTrialsAndMakeQuestions } = setup({
      count,
      evaluate: async (_, title) => { calls.push(title); return { applicableness: 50 }; },
      questions: async () => { questionCalls++; return { questions: [] }; },
    });
    const result = await searchTrialsAndMakeQuestions(input);
    assert.equal(calls.length, count);
    assert.equal(result.trialSums.length, count);
    assert.equal(questionCalls, count > 0 ? 1 : 0);
  }
});

test("a failed evaluation stops later batches and question generation", async () => {
  const pending = [];
  let questionCalls = 0;
  const failure = new Error("Mock provider failure");
  const { searchTrialsAndMakeQuestions } = setup({
    evaluate: async () => {
      const result = deferred();
      pending.push(result);
      return result.promise;
    },
    questions: async () => { questionCalls++; return { questions: [] }; },
  });
  const result = searchTrialsAndMakeQuestions(input);
  const rejection = assert.rejects(result, error => error === failure);
  await flush();
  assert.equal(pending.length, 4);
  pending[1].reject(failure);
  await rejection;
  for (const index of [0, 2, 3]) pending[index].resolve({ applicableness: 50 });
  await flush();
  assert.equal(pending.length, 4);
  assert.equal(questionCalls, 0);
});

test("cancellation prevents subsequent batches and question generation", async () => {
  const controller = new AbortController();
  const pending = [];
  let questionCalls = 0;
  const { searchTrialsAndMakeQuestions } = setup({
    evaluate: async () => {
      const result = deferred();
      pending.push(result);
      return result.promise;
    },
    questions: async () => { questionCalls++; return { questions: [] }; },
  });
  const result = searchTrialsAndMakeQuestions(input, { signal: controller.signal });
  const rejection = assert.rejects(result, { name: "AbortError" });
  await flush();
  controller.abort();
  for (const item of pending) item.resolve({ applicableness: 50 });
  await rejection;
  assert.equal(pending.length, 4);
  assert.equal(questionCalls, 0);
});

test("parallel trial scoring uses local decisions while question generation stays on Strands Google", async () => {
  const calls = [];
  class MockModel {
    constructor(config) { this.config = config; }
    getConfig() { return this.config; }
  }
  class MockAgent {
    constructor(config) { this.config = config; }
    async invoke(payload) {
      assert.equal(this.config.model.getConfig().modelId, "gemini-3.1-flash-lite");
      assert.equal(typeof JSON.parse(payload).criterion, "string");
      calls.push("questions");
      return { structuredOutput: { questions: [] } };
    }
  }
  const { createLocalDecisionModel } = load("src/lib/local-decision-model.ts");
  const { searchTrialsAndMakeQuestions } = load("src/lib/trial-workflow.ts", {
    "./clinical-trials": { searchTrialsByDiagnosis: async () => retrieval() },
    "./local-decision-model": { createLocalDecisionModel: () => createLocalDecisionModel({
      baseUrl: "http://localhost:11434", modelId: "tev1:4b", timeoutMs: 1000,
      fetcher: async (_url, options) => {
        const { state, model } = JSON.parse(options.body);
        assert.equal(model, "tev1:4b");
        const index = Number(state.title.split(" ")[1]);
        calls.push(index);
        return Response.json({ answers: { applicableness: { type: "score", score: scores[index] / 25 } } });
      },
    }) },
    "@strands-agents/sdk": { Agent: MockAgent },
    "@strands-agents/sdk/models/openai": { OpenAIModel: MockModel },
    "@strands-agents/sdk/models/google": { GoogleModel: MockModel },
  });
  const result = await searchTrialsAndMakeQuestions(input);
  assert.deepEqual(calls, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "questions"]);
  assert.deepEqual(result.trialSums.map(({ id }) => id), ["NCT6", "NCT3", "NCT1"]);
});

function rankingSetup(evaluateEligibility, rankTrials) {
  return load("src/lib/trial-workflow.ts", {
    "./clinical-trials": { searchTrialsByDiagnosis: () => assert.fail("Ranking must not retrieve trials") },
    "./evaltools": { evaluateEligibility, rankTrials },
  });
}

test("eligibility uses prepared question text, keeps false and zero, and leaves missing answers unknown", async () => {
  const trials = [trial("A"), trial("B"), trial("C")];
  const prepared = { trialSums: trials, questions };
  const before = structuredClone(prepared);
  const expectedAnswers = [
    { question: questions[0].question, answer: 0 },
    { question: questions[1].question, answer: false },
    { question: questions[2].question, answer: null },
  ];
  const calls = [];
  const { evaluateEligibilityAndRankTrials } = rankingSetup(async (answers, condition, criterion) => {
    assert.deepEqual(answers, expectedAnswers);
    assert.equal(condition, "Condition");
    calls.push(criterion);
    assert.match(criterion, /Minimum age: 18 Years/);
    assert.match(criterion, /Maximum age: 65 Years/);
    assert.match(criterion, /Sex: ALL/);
    assert.match(criterion, /Adults without prior treatment/);
    return !criterion.startsWith("Trial: B\n");
  }, async (answers, condition, eligible) => {
    assert.equal(calls.length, 3, "ranking must wait for all eligibility checks");
    assert.deepEqual(answers, expectedAnswers);
    assert.equal(condition, "Condition");
    assert.deepEqual(eligible, [trials[0], trials[2]]);
    return [
      { rank: 1, explanation: "Best fit", treatment: "Example therapy", trial: eligible[1] },
      { rank: 2, explanation: "Potential fit", treatment: null, trial: eligible[0] },
    ];
  });
  const result = await evaluateEligibilityAndRankTrials(prepared, [
    { id: "prior", question: "Untrusted replacement text", answer: false },
    { id: "age", question: "Untrusted replacement text", answer: 0 },
  ], "Condition");
  assert.deepEqual(result, {
    studies: [{ ...trials[2], rank: 1, explanation: "Best fit", treatment: "Example therapy" }, { ...trials[0], rank: 2, explanation: "Potential fit", treatment: null }],
    evaluatedCount: 3, excludedCount: 1,
  });
  assert.deepEqual(calls.map(text => text.split("\n")[0]), ["Trial: A", "Trial: B", "Trial: C"]);
  assert.deepEqual(prepared, before);
});

test("empty and fully excluded trials skip ranking with accurate counts", async () => {
  for (const count of [0, 2]) {
    let checks = 0;
    const { evaluateEligibilityAndRankTrials } = rankingSetup(async () => { checks++; return false; }, () => assert.fail("No eligible trials must skip ranking"));
    const result = await evaluateEligibilityAndRankTrials({ trialSums: Array.from({ length: count }, (_, i) => trial(String(i))), questions: [] }, [], "Condition");
    assert.deepEqual(result, { studies: [], evaluatedCount: count, excludedCount: count });
    assert.equal(checks, count);
  }
});

test("missing trial eligibility metadata is explicitly marked unknown", async () => {
  const { evaluateEligibilityAndRankTrials } = rankingSetup(async (_answers, _condition, criterion) => {
    assert.equal(criterion, "Trial: A\nMinimum age: Not provided\nMaximum age: Not provided\nSex: Not provided\nEligibility criteria: Not provided");
    return false;
  }, () => assert.fail("Excluded trial must skip ranking"));
  await evaluateEligibilityAndRankTrials({ trialSums: [trial("A", { eligibility: { minimumAge: "", maximumAge: "", sex: "", criteria: "" } })], questions: [] }, [], "Condition");
});

test("eligibility is sequential and cancellation stops later checks and ranking", async () => {
  const controller = new AbortController();
  const pending = deferred();
  let checks = 0;
  const { evaluateEligibilityAndRankTrials } = rankingSetup(async () => { checks++; return pending.promise; }, () => assert.fail("Cancelled workflow must not rank"));
  const result = evaluateEligibilityAndRankTrials({ trialSums: [trial("A"), trial("B")], questions: [] }, [], "Condition", { signal: controller.signal });
  const rejection = assert.rejects(result, { name: "AbortError" });
  await flush();
  assert.equal(checks, 1);
  controller.abort();
  pending.resolve(true);
  await rejection;
  assert.equal(checks, 1);
});

test("cancellation before ranking is checked even after the last eligibility call", async () => {
  const controller = new AbortController();
  const { evaluateEligibilityAndRankTrials } = rankingSetup(async () => { controller.abort(); return true; }, () => assert.fail("Cancelled workflow must not rank"));
  await assert.rejects(evaluateEligibilityAndRankTrials({ trialSums: [trial()], questions: [] }, [], "Condition", { signal: controller.signal }), { name: "AbortError" });
});

test("eligibility and ranking failures propagate without returning partial matches", async () => {
  const failure = new Error("Provider failed");
  for (const stage of ["eligibility", "ranking"]) {
    let checks = 0;
    const { evaluateEligibilityAndRankTrials } = rankingSetup(async () => {
      checks++;
      if (stage === "eligibility") throw failure;
      return true;
    }, async () => {
      assert.equal(stage, "ranking");
      throw failure;
    });
    await assert.rejects(evaluateEligibilityAndRankTrials({ trialSums: [trial("A"), trial("B")], questions: [] }, [], "Condition"), error => error === failure);
    assert.equal(checks, stage === "eligibility" ? 1 : 2);
  }
});

test("configured trial limits override caller page size and cap the shortlist", async () => {
  process.env.TRIAL_SEARCH_LIMIT = "20";
  process.env.TRIAL_SHORTLIST_LIMIT = "1";
  const workflow = load("src/lib/trial-workflow.ts", {
    "./clinical-trials": { searchTrialsByDiagnosis: async (params, options) => {
      assert.equal(params.pageSize, 20);
      assert.equal(params.diagnosis, input.diagnosis);
      assert.equal(options.signal, controller.signal);
      return retrieval(3);
    } },
    "./evaltools": {
      evaluateTrial: async (_summary, title) => ({ applicableness: scores[Number(title.split(" ")[1])] }),
      criterionFinder: async criterion => {
        assert.match(criterion, /Trial: NCT1/);
        assert.doesNotMatch(criterion, /Trial: NCT0|Trial: NCT2/);
        return { questions: [] };
      },
    },
  });
  const controller = new AbortController();
  const result = await workflow.searchTrialsAndMakeQuestions({ ...input, pageSize: 999 }, { signal: controller.signal });
  assert.deepEqual(result.trialSums.map(({ id }) => id), ["NCT1"]);
});

test("invalid trial limits fail before retrieval and inference", async () => {
  const { TrialSearchError } = load("src/lib/clinical-trials.ts");
  const workflow = load("src/lib/trial-workflow.ts", {
    "./clinical-trials": { TrialSearchError, searchTrialsByDiagnosis: () => assert.fail("Invalid configuration must not retrieve") },
    "./evaltools": {},
  });
  for (const [key, values] of [
    ["TRIAL_SEARCH_LIMIT", ["9", "1001", "1.5", "invalid", ""]],
    ["TRIAL_SHORTLIST_LIMIT", ["0", "1001", "1.5", "invalid", ""]],
  ]) {
    for (const value of values) {
      process.env[key] = value;
      await assert.rejects(workflow.searchTrialsAndMakeQuestions(input), error => error.status === 500 && error.message.includes(key));
    }
    delete process.env[key];
  }
});

test("clinical trial results display the treatment extracted during ranking", () => {
  const { TrialResearchResults } = load("src/components/trial-research-results.tsx");
  const result = {
    studies: [
      { ...trial("A"), rank: 1, explanation: "Potential fit", treatment: "Drug A + supplement B" },
      { ...trial("B"), rank: 2, explanation: "Potential fit", treatment: null },
    ],
    evaluatedCount: 2, excludedCount: 0,
  };
  const html = renderToStaticMarkup(createElement(TrialResearchResults, { result }));
  assert.match(html, /Drug A \+ supplement B/);
  assert.match(html, /Not identified in the trial metadata/);
});
