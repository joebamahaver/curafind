import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

// Exercise the actual TypeScript modules, substituting only external services.
function load(file, mocks = {}, cache = new Map()) {
  let filename = path.resolve(root, file);
  if (!fs.existsSync(filename)) {
    filename = [".ts", ".tsx"].map(extension => filename + extension).find(fs.existsSync);
  }
  if (cache.has(filename)) return cache.get(filename);
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith("@/")) return load("src/" + id.slice(2), mocks, cache);
    if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), id), mocks, cache);
    return require(id);
  };
  new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
  cache.set(filename, loadedModule.exports);
  return loadedModule.exports;
}

async function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const defaults = { GROQ_API_KEY: "mock-key", DRUG_EVAL_LIMIT: undefined, DRUG_DISPLAY_LIMIT: undefined };
const trialLocation = { zipCode: "64108", travelDistanceMiles: 50 };
const scores = [null, [90, 55], [95, 20], [95, 80], [20, 99], [80, 1], [100, 100]];
function setup({ missingAbstracts = false, failures = [] } = {}) {
  const calls = [];
  const articles = scores.map((_, index) => ({
    id: String(index), title: `Study ${index}`, publicationDate: "2026", journal: "Example",
    url: `https://pubmed.ncbi.nlm.nih.gov/${index}/`, extraMetadata: { retained: true },
  }));
  const mocks = {
    "@/lib/drug-research": {
      searchDrugResearch: async condition => {
        calls.push(["search", condition]);
        return articles.map(article => article.id);
      },
      getArticleDetails: async () => articles,
      readPubMedArticles: async () => articles.map(article => ({
        pmid: article.id, abstract: missingAbstracts || article.id === "0" ? null : article.id,
      })),
    },
    "@/lib/evaltools": {
      evaluateStudy: async (condition, abstract) => {
        calls.push(["evaluate", condition, abstract]);
        if (failures.includes(abstract)) throw new Error("Mock provider failure");
        const [applicableness, efficacy] = scores[Number(abstract)];
        return { applicableness, efficacy, treatment: `Treatment ${abstract}` };
      },
    },
  };
  return { ...load("src/app/actions/drug-research.ts", mocks), calls };
}

test("defaults cap evaluation at five usable abstracts and display two, ranking applicability before efficacy", async () => {
  await withEnv(defaults, async () => {
    const { searchAndEvaluateDrugs, calls } = setup();
    const result = await searchAndEvaluateDrugs("  Example condition  ");
    assert.equal(result.success, true);
    assert.deepEqual(calls.filter(call => call[0] === "evaluate").map(call => call[2]), ["1", "2", "3", "4", "5"]);
    assert.equal(calls.every(call => call[1] === "Example condition"), true);
    assert.equal(result.data.articlesSearched, 7);
    assert.equal(result.data.evaluatedCount, 5);
    assert.deepEqual(result.data.articles.map(article => article.id), ["3", "2", "1", "5", "4"]);
    assert.deepEqual(result.data.topArticles.map(article => article.id), ["3", "2"]);
    assert.equal(result.data.articles[0].abstract, "3");
    assert.deepEqual(result.data.articles[0].extraMetadata, { retained: true });
    assert.equal(result.data.articles[0].treatment, "Treatment 3");
  });
});

test("environment settings independently change evaluation and display counts", async () => {
  await withEnv({ ...defaults, DRUG_EVAL_LIMIT: "3", DRUG_DISPLAY_LIMIT: "1" }, async () => {
    const { searchAndEvaluateDrugs, calls } = setup();
    const result = await searchAndEvaluateDrugs("Example condition");
    assert.equal(calls.filter(call => call[0] === "evaluate").length, 3);
    assert.equal(result.data.articles.length, 3);
    assert.deepEqual(result.data.topArticles.map(article => article.id), ["3"]);
  });
});

test("invalid input, configuration, and missing key fail before retrieval or inference", async () => {
  for (const values of [
    { ...defaults, DRUG_EVAL_LIMIT: "0" },
    { ...defaults, DRUG_DISPLAY_LIMIT: "1.5" },
    { ...defaults, DRUG_EVAL_LIMIT: "invalid" },
    { ...defaults, GROQ_API_KEY: "" },
  ]) {
    await withEnv(values, async () => {
      const { searchAndEvaluateDrugs, calls } = setup();
      assert.equal((await searchAndEvaluateDrugs("Example")).success, false);
      assert.deepEqual(calls, []);
    });
  }
  await withEnv(defaults, async () => {
    const { searchAndEvaluateDrugs, calls } = setup();
    for (const input of [" ", "x".repeat(201), null, 123]) {
      assert.equal((await searchAndEvaluateDrugs(input)).success, false);
    }
    assert.deepEqual(calls, []);
  });
});

test("missing abstracts make no LLM calls and return an empty result", async () => {
  await withEnv(defaults, async () => {
    const { searchAndEvaluateDrugs, calls } = setup({ missingAbstracts: true });
    const result = await searchAndEvaluateDrugs("Example");
    assert.equal(result.success, true);
    assert.deepEqual(result.data.topArticles, []);
    assert.equal(calls.some(call => call[0] === "evaluate"), false);
  });
});

test("partial provider failures preserve successful scores; total failure returns a retry error", async () => {
  await withEnv(defaults, async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const partial = await setup({ failures: ["2"] }).searchAndEvaluateDrugs("Example");
      assert.equal(partial.success, true);
      assert.equal(partial.data.failedCount, 1);
      assert.equal(partial.data.evaluatedCount, 4);
      assert.deepEqual(partial.data.topArticles.map(article => article.id), ["3", "1"]);
      const failed = await setup({ failures: ["1", "2", "3", "4", "5"] }).searchAndEvaluateDrugs("Example");
      assert.equal(failed.success, false);
      assert.match(failed.error, /could be evaluated/);
    } finally {
      console.error = originalError;
    }
  });
});

test("the browser drug path invokes a Server Function without fetching an API route and ignores cancelled results", async () => {
  let actionCalls = 0;
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const client = load("src/lib/research-search-client.ts", {
    "@/app/actions/drug-research": {
      searchAndEvaluateDrugs: async condition => {
        actionCalls++;
        assert.equal(condition, "Example");
        return pending;
      },
    },
  });
  const controller = new AbortController();
  const search = client.requestResearchSearch({ condition: "Example", clinicalTrials: false, offLabelDrugsOrSupplements: true }, controller.signal, () => { throw new Error("Must not fetch an API route"); });
  controller.abort();
  finish({ success: true, data: { articles: [], topArticles: [] } });
  await assert.rejects(search, { name: "AbortError" });
  assert.equal(actionCalls, 1);
});

test("result cards render only the selected top results with source links and both scores", async () => {
  await withEnv(defaults, async () => {
    const { data } = await setup().searchAndEvaluateDrugs("Example");
    const { createElement } = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const { DrugResearchResults } = load("src/components/drug-research-results.tsx");
    const html = renderToStaticMarkup(createElement(DrugResearchResults, { result: data }));
    assert.match(html, /Treatment 3/);
    assert.match(html, /Treatment 2/);
    assert.doesNotMatch(html, /Treatment 1/);
    assert.match(html, /Treatment:<\/span>/);
    assert.equal((html.match(/data-slot="card"/g) ?? []).length, 2);
    assert.match(html, /Applicability/);
    assert.match(html, /Estimated efficacy/);
    assert.match(html, /https:\/\/pubmed.ncbi.nlm.nih.gov\/3\//);
    assert.match(html, /data-slot="card-title"[^>]*>[\s\S]*?Study 3/);
    assert.match(html, /<p class="whitespace-pre-wrap[^>]*>3<\/p>/);
    assert.doesNotMatch(html, /Read abstract/);
  });
});

test("a failed drug search does not discard successful clinical trial results", async () => {
  const trials = { studies: [{ id: "NCT00000001" }], nextPageToken: "next-page", totalCount: 20 };
  const client = load("src/lib/research-search-client.ts", {
    "@/app/actions/drug-research": {
      searchAndEvaluateDrugs: async () => ({ success: false, error: "Drug provider unavailable" }),
    },
  });
  const result = await client.requestResearchSearch({ condition: "Example", ...trialLocation, clinicalTrials: true, offLabelDrugsOrSupplements: true }, undefined, async () => Response.json(trials));
  assert.deepEqual(result.clinicalTrials, trials);
  assert.equal(result.drugResearch, null);
  assert.deepEqual(result.errors, { drugResearch: "Drug provider unavailable" });
});

test("a failed clinical trial search does not discard successful drug results", async () => {
  const drugs = { diagnosis: "Example", articles: [{ id: "123", treatment: "Example therapy" }], topArticles: [] };
  const client = load("src/lib/research-search-client.ts", {
    "@/app/actions/drug-research": {
      searchAndEvaluateDrugs: async () => ({ success: true, data: drugs }),
    },
  });
  const result = await client.requestResearchSearch({ condition: "Example", ...trialLocation, clinicalTrials: true, offLabelDrugsOrSupplements: true }, undefined, async () => Response.json({ error: "Trials unavailable" }, { status: 502 }));
  assert.equal(result.clinicalTrials, null);
  assert.deepEqual(result.drugResearch, drugs);
  assert.deepEqual(result.errors, { clinicalTrials: "Trials unavailable" });
});

test("checkbox selection calls only the selected paths and preserves their complete JSON", async () => {
  const trials = { studies: [{ id: "NCT00000001", extra: "retained" }], nextPageToken: "next-page", totalCount: 20 };
  const drugs = { diagnosis: "Example", articles: [{ id: "123", abstract: "Full abstract", applicableness: 90, efficacy: 70, treatment: null }], topArticles: [], extra: "retained" };
  for (const [clinicalTrials, offLabelDrugsOrSupplements] of [[true, false], [false, true], [true, true]]) {
    const calls = [];
    const signal = new AbortController().signal;
    const client = load("src/lib/research-search-client.ts", {
      "@/app/actions/drug-research": {
        searchAndEvaluateDrugs: async condition => {
          calls.push("drugs");
          assert.equal(condition, "Example");
          return { success: true, data: drugs };
        },
      },
    });
    const result = await client.requestResearchSearch({ condition: "  Example  ", ...trialLocation, clinicalTrials, offLabelDrugsOrSupplements }, signal, async (url, options) => {
      calls.push("trials");
      assert.equal(url, "/api/trials");
      assert.equal(options.method, "POST");
      assert.equal(options.signal, signal);
      assert.deepEqual(JSON.parse(options.body), { diagnosis: "Example", recruitment: "recruiting-or-upcoming", ...trialLocation });
      return Response.json(trials);
    });
    assert.deepEqual(result, { clinicalTrials: clinicalTrials ? trials : null, drugResearch: offLabelDrugsOrSupplements ? drugs : null });
    assert.equal(calls.includes("trials"), clinicalTrials);
    assert.equal(calls.includes("drugs"), offLabelDrugsOrSupplements);
    assert.equal(calls.length, Number(clinicalTrials) + Number(offLabelDrugsOrSupplements));
  }
});

test("failed selected searches still reject so the form shows its retry state", async () => {
  const client = load("src/lib/research-search-client.ts", {
    "@/app/actions/drug-research": {
      searchAndEvaluateDrugs: async () => ({ success: false, error: "Drug provider unavailable" }),
    },
  });
  const failedTrials = async () => Response.json({ error: "Trials unavailable" }, { status: 502 });
  await assert.rejects(client.requestResearchSearch({ condition: "Example", ...trialLocation, clinicalTrials: true, offLabelDrugsOrSupplements: true }, undefined, failedTrials), /Trials unavailable.*Drug provider unavailable/);
  await assert.rejects(client.requestResearchSearch({ condition: "Example", clinicalTrials: false, offLabelDrugsOrSupplements: true }, undefined, failedTrials), /Drug provider unavailable/);
  await assert.rejects(client.requestResearchSearch({ condition: "Example", ...trialLocation, clinicalTrials: true, offLabelDrugsOrSupplements: false }, undefined, failedTrials), /Trials unavailable/);
});

test("clinical trial searches require a valid ZIP and distance before either search is dispatched", async () => {
  const client = load("src/lib/research-search-client.ts", {
    "@/app/actions/drug-research": { searchAndEvaluateDrugs: () => assert.fail("Must not dispatch inference") },
  });
  for (const location of [{}, { zipCode: "abcde", travelDistanceMiles: 50 }, { zipCode: "64108", travelDistanceMiles: null }, { zipCode: "64108", travelDistanceMiles: 0 }]) {
    await assert.rejects(client.requestResearchSearch({ condition: "Example", ...location, clinicalTrials: true, offLabelDrugsOrSupplements: true }, undefined, () => assert.fail("Must not fetch trials")), /ZIP code|travel|Travel/);
  }
});

test("unselected searches, blank input, and already-cancelled requests never dispatch work", async () => {
  const client = load("src/lib/research-search-client.ts", {
    "@/app/actions/drug-research": { searchAndEvaluateDrugs: () => { throw new Error("Must not dispatch"); } },
  });
  const fetcher = () => { throw new Error("Must not fetch"); };
  await assert.rejects(client.requestResearchSearch({ condition: "Example", clinicalTrials: false, offLabelDrugsOrSupplements: false }, undefined, fetcher), /Select at least one/);
  await assert.rejects(client.requestResearchSearch({ condition: " ", clinicalTrials: true, offLabelDrugsOrSupplements: true }, undefined, fetcher), /Enter a condition/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.requestResearchSearch({ condition: "Example", clinicalTrials: true, offLabelDrugsOrSupplements: true }, controller.signal, fetcher), { name: "AbortError" });
});
