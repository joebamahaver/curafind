import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { load, withEnv } from "./helpers/load.mjs";

const { createLocalDecisionModel } = load("src/lib/local-decision-model.ts");
const scoreQuestion = { type: "score", instructions: "How relevant?", criteria: ["None", "Moderate", "Strong"] };
const questions = {
  relevance: scoreQuestion,
  eligible: { type: "noul", instructions: "Could qualify?", criteria: { true: "Potential fit", false: "Clear violation" } },
  category: { type: "choice", instructions: "Pick a category", criteria: { drug: "Drug", other: null } },
};
const output = {
  model: "tev1:4b",
  answers: {
    relevance: { type: "score", score: 1.7, legend: ["None", "Moderate", "Strong"], probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 }, confidence: 0.8 },
    eligible: { type: "noul", noul: 0.9 },
    category: { type: "choice", choice: "drug", probabilities: { drug: 0.9, other: 0.1 }, confidence: 0.9 },
  },
  usage: { input_tokens: 100, output_tokens: 3 },
};
const config = { baseUrl: "http://localhost:11434", modelId: "tev1:4b", timeoutMs: 1000 };

test("local model posts the documented System One shape and returns typed values", async () => {
  const state = { summary: "Input with quotes: \"A\"", answers: [false, 0, null] };
  const model = createLocalDecisionModel({ ...config, fetcher: async (url, options) => {
    assert.equal(url.href, "http://localhost:11434/v1/systemone");
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, { "Content-Type": "application/json" });
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { model: "tev1:4b", state, questions });
    return Response.json(output);
  } });
  assert.deepEqual(await model.invoke(state, questions), { relevance: 1.7, eligible: 0.9, category: "drug" });
});

test("model reads local defaults without any API key", async () => {
  await withEnv({ OLLAMA_BASE_URL: undefined, DECISIONS_MODEL: undefined, DECISIONS_TIMEOUT_MS: undefined, GROQ_API_KEY: undefined }, async () => {
    assert.deepEqual(createLocalDecisionModel().getConfig(), { baseUrl: "http://127.0.0.1:11434/", modelId: "tev1:4b", timeoutMs: 120000 });
  });
});

test("environment configuration and explicit overrides preserve proxy path prefixes", async () => {
  await withEnv({ OLLAMA_BASE_URL: "http://localhost:1234/proxy", DECISIONS_MODEL: "tev1:0.8b", DECISIONS_TIMEOUT_MS: "500" }, async () => {
    const model = createLocalDecisionModel({ fetcher: async (url, options) => {
      assert.equal(url.href, "http://localhost:1234/proxy/v1/systemone");
      assert.equal(JSON.parse(options.body).model, "tev1:0.8b");
      return Response.json(output);
    } });
    assert.equal(model.getConfig().timeoutMs, 500);
    await model.invoke("Input", questions);
    assert.deepEqual(createLocalDecisionModel(config).getConfig(), { baseUrl: "http://localhost:11434/", modelId: "tev1:4b", timeoutMs: 1000 });
  });
});

for (const [label, overrides] of [
  ["invalid URL", { baseUrl: "not a URL" }],
  ["unsupported protocol", { baseUrl: "file:///tmp/model" }],
  ["URL query", { baseUrl: "http://localhost:11434?x=1" }],
  ["URL fragment", { baseUrl: "http://localhost:11434#x" }],
  ["empty model", { modelId: " " }],
  ["zero timeout", { timeoutMs: 0 }],
  ["fractional timeout", { timeoutMs: 1.5 }],
  ["nonfinite timeout", { timeoutMs: Infinity }],
  ["overflow timeout", { timeoutMs: 2147483648 }],
]) {
  test(`local model rejects ${label}`, () => {
    assert.throws(() => createLocalDecisionModel({ ...config, ...overrides }));
  });
}

test("invalid questions and oversized UTF-8 requests fail before HTTP dispatch", async () => {
  const model = createLocalDecisionModel({ ...config, fetcher: () => assert.fail("Invalid input must not fetch") });
  for (const questions of [
    {}, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), scoreQuestion])),
    { score: { ...scoreQuestion, criteria: ["Only one"] } },
    { score: { ...scoreQuestion, criteria: Array(11).fill("Level") } },
    { score: { ...scoreQuestion, instructions: " " } },
    { category: { type: "choice", instructions: "Pick", criteria: { only: null } } },
    { category: { type: "chat", instructions: "Generate text" } },
  ]) await assert.rejects(model.invoke("State", questions));
  await assert.rejects(model.invoke("  ", { relevance: scoreQuestion }), /must not be empty/);
  await assert.rejects(model.invoke("é".repeat(33000), { relevance: scoreQuestion }), /64 KiB/);
});

for (const [label, response] of [
  ["missing answers", {}],
  ["missing named answer", { answers: {} }],
  ["wrong answer type", { answers: { relevance: { type: "noul", score: 1 } } }],
  ["negative score", { answers: { relevance: { type: "score", score: -0.1 } } }],
  ["score above rubric", { answers: { relevance: { type: "score", score: 2.1 } } }],
  ["numeric string score", { answers: { relevance: { type: "score", score: "1" } } }],
  ["boolean probability", { answers: { eligible: { type: "noul", noul: true } } }],
  ["probability above one", { answers: { eligible: { type: "noul", noul: 1.01 } } }],
  ["negative probability", { answers: { eligible: { type: "noul", noul: -0.1 } } }],
  ["unknown choice", { answers: { category: { type: "choice", choice: "unknown" } } }],
]) {
  test(`local model rejects ${label}`, async () => {
    const name = label.includes("probability") ? "eligible" : label.includes("choice") ? "category" : "relevance";
    const model = createLocalDecisionModel({ ...config, fetcher: async () => Response.json(response) });
    await assert.rejects(model.invoke("Input", { [name]: questions[name] }));
  });
}

test("HTTP failures, unreadable JSON and network errors propagate without retry", async () => {
  for (const [fetcher, message] of [
    [async () => new Response("Model not found", { status: 404 }), /HTTP 404/],
    [async () => new Response("Service unavailable", { status: 503 }), /HTTP 503/],
    [async () => new Response("not JSON"), /unreadable JSON/],
    [async () => { throw new Error("Network failed"); }, /Network failed/],
  ]) {
    let calls = 0;
    const model = createLocalDecisionModel({ ...config, fetcher: async (...args) => { calls++; return fetcher(...args); } });
    await assert.rejects(model.invoke("Input", questions), message);
    assert.equal(calls, 1);
  }
});

test("caller cancellation and timeouts abort local HTTP calls", async () => {
  for (const mode of ["caller", "timeout"]) {
    const controller = new AbortController();
    const model = createLocalDecisionModel({ ...config, timeoutMs: mode === "timeout" ? 10 : 1000, fetcher: async (_url, options) => {
      if (mode === "caller") controller.abort();
      await setTimeout(5000, undefined, { signal: options.signal });
      return Response.json(output);
    } });
    await assert.rejects(model.invoke("Input", questions, { signal: controller.signal }), { name: "AbortError" });
  }
});

test("cancellation during response parsing prevents stale decision results", async () => {
  const controller = new AbortController();
  const model = createLocalDecisionModel({ ...config, fetcher: async () => ({ ok: true, json: async () => { controller.abort(); return output; } }) });
  await assert.rejects(model.invoke("Input", questions, { signal: controller.signal }), { name: "AbortError" });
});
