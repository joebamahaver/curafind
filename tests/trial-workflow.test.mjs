import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

function load(file, mocks, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename);
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith(".")) {
      return load(path.resolve(path.dirname(filename), id + ".ts"), mocks, cache);
    }
    return require(id);
  };
  new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const input = { diagnosis: "Example condition", pageSize: 10 };
const scores = [12, 93, 23, 95, 61, 42, 97, 82, 75, 30];
function retrieval(count = 10) {
  return {
    studies: Array.from({ length: count }, (_, index) => ({
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
  assert.deepEqual(result.studies.map(({ id, applicableness, rank }) => [id, applicableness, rank]), [
    ["NCT6", 97, 1], ["NCT3", 95, 2], ["NCT1", 93, 3],
  ]);
  assert.equal(result.studies[0].url, retrieved.studies[6].url);
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
    assert.equal(result.studies.length, count);
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

test("parallel trial calls use the actual model rotation and a fresh agent for every evaluation", async () => {
  const previous = process.env.CEREBRAS_API_KEY;
  process.env.CEREBRAS_API_KEY = "mock-cerebras";
  try {
    const agents = [];
    class MockModel {
      constructor(config) { this.config = config; }
      getConfig() { return this.config; }
    }
    class MockAgent {
      constructor(config) { this.config = config; agents.push(this); }
      async invoke(payload) {
        const data = JSON.parse(payload);
        return { structuredOutput: data.criterion !== undefined
          ? { questions: [] }
          : { applicableness: scores[Number(data.title.split(" ")[1])] } };
      }
    }
    const { searchTrialsAndMakeQuestions } = load("src/lib/trial-workflow.ts", {
      "./clinical-trials": { searchTrialsByDiagnosis: async () => retrieval() },
      "@strands-agents/sdk": { Agent: MockAgent },
      "@strands-agents/sdk/models/openai": { OpenAIModel: MockModel },
      "@strands-agents/sdk/models/google": { GoogleModel: MockModel },
      "./vicort": { vicort: "mock prompt" },
    });
    const result = await searchTrialsAndMakeQuestions(input);
    const pool = ["openai/gpt-oss-20b", "qwen-3.8-27b", "gemma-4-26b-a4b-it", "gemma-4-31b-it", "gemini-3.1-flash-lite"];
    assert.deepEqual(agents.map(agent => agent.config.model.getConfig().modelId), [...pool, ...pool, pool[0]]);
    assert.equal(new Set(agents).size, 11);
    assert.deepEqual(result.studies.map(({ id }) => id), ["NCT6", "NCT3", "NCT1"]);
  } finally {
    if (previous === undefined) delete process.env.CEREBRAS_API_KEY;
    else process.env.CEREBRAS_API_KEY = previous;
  }
});

test("Google incomplete-stream failures retry once with a fresh Groq agent and unchanged input", async () => {
  const previous = process.env.CEREBRAS_API_KEY;
  process.env.CEREBRAS_API_KEY = "mock-cerebras";
  try {
    const calls = [];
    const google = "gemma-4-26b-a4b-it";
    const groq = "openai/gpt-oss-20b";
    class MockModel {
      constructor(config) { this.config = config; }
      getConfig() { return this.config; }
    }
    class MockGoogleModel extends MockModel {}

    for (const scenario of ["recover", "retry-fails", "unrelated-error", "invalid-score"]) {
      calls.length = 0;
      const original = new Error(scenario === "unrelated-error"
        ? "Mock provider unavailable"
        : "Incomplete JSON segment at the end");
      const fallbackFailure = new Error("Groq unavailable");
      class MockAgent {
        constructor(config) { this.config = config; }
        async invoke(payload) {
          const modelId = this.config.model.getConfig().modelId;
          calls.push({ agent: this, modelId, payload });
          if (modelId === google) {
            if (scenario === "invalid-score") return { structuredOutput: { applicableness: 101 } };
            throw original;
          }
          if (modelId === groq && JSON.parse(payload).title === "Target" && scenario === "retry-fails") {
            throw fallbackFailure;
          }
          return { structuredOutput: { applicableness: 80 } };
        }
      }
      const { evaluateTrial } = load("src/lib/evaltools.ts", {
        "@strands-agents/sdk": { Agent: MockAgent },
        "@strands-agents/sdk/models/openai": { OpenAIModel: MockModel },
        "@strands-agents/sdk/models/google": { GoogleModel: MockGoogleModel },
        "./vicort": { vicort: "mock prompt" },
      });
      await evaluateTrial("warmup", "Warmup", "condition", []);
      await evaluateTrial("warmup", "Warmup", "condition", []);
      const result = evaluateTrial("trial summary", "Target", "condition", ["trial condition"]);
      if (scenario === "recover") {
        assert.deepEqual(await result, { applicableness: 80 });
      } else if (scenario === "retry-fails") {
        await assert.rejects(result, error => error === fallbackFailure);
      } else if (scenario === "unrelated-error") {
        await assert.rejects(result, error => error === original);
      } else {
        await assert.rejects(result, error => error.name === "ZodError");
      }
      const attempts = calls.slice(2);
      assert.deepEqual(attempts.map(call => call.modelId),
        scenario === "recover" || scenario === "retry-fails" ? [google, groq] : [google]);
      if (attempts.length === 2) {
        assert.notEqual(attempts[0].agent, attempts[1].agent);
        assert.equal(attempts[0].payload, attempts[1].payload);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.CEREBRAS_API_KEY;
    else process.env.CEREBRAS_API_KEY = previous;
  }
});
