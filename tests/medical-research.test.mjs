import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { Model } from "@strands-agents/sdk";
import { searchTrialsWithEligibility } from "../docker/medical-mcp/trial-search.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function load(file, mocks = {}, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename);
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = id => Object.hasOwn(mocks, id) ? mocks[id]
    : id.startsWith("@/") ? load("src/" + id.slice(2) + (path.extname(id) ? "" : ".ts"), mocks, cache)
    : id.startsWith(".") ? load(path.resolve(path.dirname(filename), id + (path.extname(id) ? "" : ".ts")), mocks, cache) : require(id);
  new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const request = { condition: "asthma", zipCode: "00123", travelDistanceMiles: 50, clinicalTrials: true, offLabelDrugsOrSupplements: true };
const trial = {
  id: "NCT12345678", title: "Example asthma trial", url: "https://clinicaltrials.gov/study/NCT12345678",
  abstract: "A trial of asthma therapy.", treatment: "Example therapy", explanation: "Potential fit, subject to confirmation.",
  eligibility: "uncertain", uncertainties: ["Study team confirmation required."], sourceIds: ["trial-source"],
};
const article = {
  ...trial, id: "12345", title: "Example asthma article", url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
  abstract: "Example abstract.", sourceIds: ["article-source"],
};
const sourceRecords = [
  { id: "trial-source", tool: "search-trials-with-eligibility", input: {},
    result: { content: [{ type: "text", text: JSON.stringify({
      studies: [{ protocolSection: {
        identificationModule: { nctId: trial.id, briefTitle: trial.title },
        descriptionModule: { briefSummary: trial.abstract },
        eligibilityModule: { eligibilityCriteria: "Inclusion: adults age 18 or older." },
      }, resultsSection: { unusedResults: "ADMINISTRATIVE_SENTINEL".repeat(1000) } }], sourceUrls: [trial.url],
    }) }] } },
  { id: "article-source", tool: "search-medical-literature", input: {},
    result: { content: [{ type: "text", text: "1. **" + article.title + "**\n   PMID: " + article.id + "\n   Abstract: " + article.abstract + "\n   URL: " + article.url + "\n" }] } },
];
const report = { summary: "Research summary.", trials: [trial], research: [article], limitations: [] };

function collectSources(value, result = []) {
  if (value && typeof value === "object") {
    if (typeof value.sourceId === "string" && value.result) result.push(value);
    for (const item of Object.values(value)) collectSources(item, result);
  }
  return result;
}

function workflow({ onResume, failResume = false, repeatSearch = false, failCleanup = false, forceFinal = false } = {}) {
  const calls = [];
  const models = [];
  let disconnects = 0;
  class ScriptedGoogleModel extends Model {
    constructor(config) { super(); this.config = config; this.turns = []; models.push(this); }
    getConfig() { return this.config; }
    updateConfig(config) { this.config = { ...this.config, ...config }; }
    async *stream(messages, options) {
      const data = messages.map(message => message.toJSON());
      this.turns.push(data);
      const sources = collectSources(data);
      const answered = JSON.stringify(data).includes('"answer":');
      if (answered && forceFinal) {
        if (!options?.toolChoice) {
          yield { type: "modelMessageStartEvent", role: "assistant" };
          yield { type: "modelContentBlockStartEvent" };
          yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "Research complete." } };
          yield { type: "modelContentBlockStopEvent" };
          yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
          return;
        }
        assert.deepEqual(options.toolChoice, { tool: { name: "strands_structured_output" } });
        const schema = options.toolSpecs.find(spec => spec.name === "strands_structured_output").inputSchema;
        assert.equal(schema.properties.trials.maxItems, undefined);
        assert.equal(schema.properties.research.maxItems, undefined);
      }
      let uses;
      if (!sources.length) {
        uses = [
          ["search-trials-with-eligibility", { condition: "malicious override", zipCode: "99999", travelDistanceMiles: 9999, limit: 25 }],
          ["search-medical-literature", { query: "asthma", max_results: 20 }],
        ];
      } else if (repeatSearch && !JSON.stringify(data).includes('"alreadyRetrieved":true')) {
        uses = [["search-medical-literature", { max_results: 5, query: "asthma" }]];
      } else if (!answered) {
        uses = [["ask_eligibility_questions", { questions: [{
          question: "How old are you?", type: "number", criterionIds: ["NCT12345678:c0"],
        }] }]];
      } else {
        await onResume?.(data);
        if (failResume) throw new Error("Mock model failure");
        uses = [["strands_structured_output", {
          ...report,
          trials: [{ ...trial, sourceIds: [sources.find(source => JSON.stringify(source.result).includes("NCT12345678")).sourceId] }],
          research: [{ ...article, sourceIds: [sources.find(source => JSON.stringify(source.result).includes("Example asthma article")).sourceId] }],
        }]];
      }
      yield { type: "modelMessageStartEvent", role: "assistant" };
      for (const [index, [name, input]] of uses.entries()) {
        yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name, toolUseId: name + "-" + index } };
        yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(input) } };
        yield { type: "modelContentBlockStopEvent" };
      }
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
    }
  }
  const exports = load("src/lib/medical-research.ts", {
    "@strands-agents/sdk/models/google": { GoogleModel: ScriptedGoogleModel },
    "./medical-mcp.ts": {
      connectMedicalMcp: async () => ({
        tools: sourceRecords.map(source => ({
          name: source.tool, description: "Mock source", toolSpec: { inputSchema: { type: "object", additionalProperties: true } },
        })),
        client: {
          callTool: async (remote, args) => {
            calls.push([remote.name, args]);
            await new Promise(resolve => setImmediate(resolve));
            return sourceRecords.find(source => source.tool === remote.name).result;
          },
          disconnect: async () => {
            disconnects++;
            if (failCleanup) throw new DOMException("Mock disconnect aborted", "AbortError");
          },
        },
      }),
    },
  });
  return { ...exports, calls, models, disconnects: () => disconnects };
}

async function env(run) {
  const key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "mock-key";
  globalThis.curafindMedicalSessions?.clear();
  try { return await run(); }
  finally {
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
    globalThis.curafindMedicalSessions?.clear();
  }
}

test("real Strands agent pauses, snapshots, resumes with canonical answers, and retains raw MCP JSON", async () => env(async () => {
  const app = workflow({ onResume: data => assert.match(JSON.stringify(data), /"answer":42/) });
  const first = await app.startMedicalResearch(request);
  assert.equal(first.status, "questions");
  assert.equal(first.questions[0].question, "How old are you?");
  assert.equal(first.questions[0].criterion, "Inclusion: adults age 18 or older.");
  assert.equal(first.sources.length, 2);
  assert.deepEqual(app.calls.map(call => call[0]), ["search-trials-with-eligibility", "search-medical-literature"]);
  assert.deepEqual(app.calls[0][1], { condition: "asthma", zipCode: "00123", travelDistanceMiles: 50, limit: 10 });
  assert.equal(app.calls[1][1].max_results, 5);
  assert.equal(app.calls[1][1].rerank, false);
  const final = await app.resumeMedicalResearch({
    sessionId: first.sessionId, answers: [{ id: first.questions[0].id, question: "Injected question", answer: 42 }],
  });
  assert.equal(final.status, "complete");
  assert.equal(final.report.trials[0].id, trial.id);
  assert.equal(final.report.research[0].abstract, article.abstract);
  assert.deepEqual(final.sources, first.sources);
  assert.deepEqual(final.sources.map(source => source.result), sourceRecords.map(source => source.result));
  for (const model of app.models) {
    assert.equal(JSON.stringify(model.turns).includes("ADMINISTRATIVE_SENTINEL"), false,
      "raw metadata must stay out of model turns, including after loading a snapshot");
  }
  assert.equal(app.calls.length, 2, "resume must reuse retrieved evidence");
  assert.equal(app.models.every(model => model.getConfig().modelId === "gemini-3.1-flash-lite"), true);
  assert.equal(app.models.length, 2);
  assert.equal(app.disconnects(), 2);
  await assert.rejects(app.resumeMedicalResearch({ sessionId: first.sessionId, answers: [] }), /expired/);
}));

test("research sessions are isolated, unknown answers fail, and omitted answers stay null", async () => env(async () => {
  const app = workflow();
  const first = await app.startMedicalResearch(request);
  const second = await app.startMedicalResearch({ ...request, condition: "other condition" });
  assert.notEqual(first.sessionId, second.sessionId);
  const question = first.questions[0];
  await assert.rejects(app.resumeMedicalResearch({ sessionId: first.sessionId, answers: [{ id: "wrong", answer: 30 }] }), /prepared question/);
  await assert.rejects(app.resumeMedicalResearch({ sessionId: first.sessionId, answers: [{ id: question.id, answer: "thirty" }] }), /wrong type/);
  const normalized = app.validateAnswers(first.questions, { sessionId: first.sessionId, answers: [] });
  assert.equal(normalized[0].answer, null);
  await app.resumeMedicalResearch({ sessionId: first.sessionId, answers: [] });
  assert.equal(globalThis.curafindMedicalSessions.has(second.sessionId), true);
}));

test("resume can force final output with a Gemini-compatible schema while server limits remain enforced", async () => env(async () => {
  const app = workflow({ forceFinal: true });
  const first = await app.startMedicalResearch(request);
  const final = await app.resumeMedicalResearch({ sessionId: first.sessionId, answers: [] });
  assert.equal(final.status, "complete");
  assert.equal(app.models[1].turns.length, 2, "plain text must trigger a forced final tool call");
  assert.throws(() => app.validateReport({ ...report, trials: Array(26).fill(trial) }, request, sourceRecords), /25/);
  assert.throws(() => app.validateReport({ ...report, research: Array(21).fill(article) }, request, sourceRecords), /20/);
}));

test("disconnect aborts do not replace model failures or completed reports", async t => env(async () => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const failing = workflow({ failResume: true, failCleanup: true });
  const first = await failing.startMedicalResearch(request);
  await assert.rejects(failing.resumeMedicalResearch({ sessionId: first.sessionId, answers: [] }), /Mock model failure/);
  assert.equal(globalThis.curafindMedicalSessions.get(first.sessionId).busy, false);
  assert.equal(failing.disconnects(), 2);
  const working = workflow({ failCleanup: true });
  const next = await working.startMedicalResearch(request);
  assert.equal((await working.resumeMedicalResearch({ sessionId: next.sessionId, answers: [] })).status, "complete");
  assert.equal(warnings.length, 4);
}));

test("MCP connection errors survive a failing disconnect during setup", async t => {
  let disconnects = 0;
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const { connectMedicalMcp } = load("src/lib/medical-mcp.ts", {
    "@strands-agents/sdk": { McpClient: class {
      async listTools() { throw new Error("Mock MCP connection failure"); }
      async disconnect() { disconnects++; throw new DOMException("Mock disconnect aborted", "AbortError"); }
    } },
  });
  await assert.rejects(connectMedicalMcp(), /Mock MCP connection failure/);
  assert.equal(disconnects, 1);
  assert.equal(warnings.length, 1);
});

test("busy sessions reject duplicate submissions and clear their lock when complete", async () => env(async () => {
  let finish;
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  const app = workflow({ onResume: async () => { entered(); await pending; } });
  const first = await app.startMedicalResearch(request);
  const input = { sessionId: first.sessionId, answers: [] };
  const result = app.resumeMedicalResearch(input);
  await enteredPromise;
  await assert.rejects(app.resumeMedicalResearch(input), /already processing/);
  finish();
  assert.equal((await result).status, "complete");
}));

test("unretrieved studies, altered abstracts, bad URLs, duplicate IDs and wrong search paths fail validation", () => {
  const { validateReport } = workflow();
  assert.deepEqual(validateReport(report, request, sourceRecords), report);
  for (const patch of [
    { sourceIds: ["invented"] }, { id: "invented" }, { title: "Invented title" },
    { url: "https://example.com/invented" }, { url: "javascript:alert(1)" },
    { abstract: "Invented benefits." }, { eligibility: "not-applicable" },
  ]) assert.throws(() => validateReport({ ...report, trials: [{ ...trial, ...patch }] }, request, sourceRecords));
  assert.throws(() => validateReport({ ...report, trials: [trial, trial] }, request, sourceRecords), /duplicate/);
  assert.throws(() => validateReport(report, { ...request, clinicalTrials: false }, sourceRecords), /unselected/);
  assert.throws(() => validateReport({ ...report, trials: [], research: [] }, request, []), /did not run/);
  assert.throws(() => validateReport({ ...report, trials: [{ ...trial, title: "Invented title" }] }, request, sourceRecords),
    /NCT12345678: title does not match cited source\(s\) trial-source/);
});

test("invalid requests, missing keys and cancelled searches never connect to MCP", async () => env(async () => {
  const app = workflow();
  for (const input of [{ ...request, condition: " " }, { ...request, zipCode: "abcde" }, { ...request, travelDistanceMiles: 0 },
    { ...request, clinicalTrials: false, offLabelDrugsOrSupplements: false }]) {
    await assert.rejects(app.startMedicalResearch(input));
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(app.startMedicalResearch(request, controller.signal), { name: "AbortError" });
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(app.startMedicalResearch(request), /GEMINI_API_KEY/);
  assert.equal(app.disconnects(), 0);
}));

test("MCP trial extension resolves ZIP first, filters radius before retrieval, and retains full protocol metadata", async () => {
  const urls = [];
  const fullStudy = { protocolSection: { identificationModule: { nctId: trial.id }, eligibilityModule: { eligibilityCriteria: "Full criteria" } }, extraMetadata: { preserved: true } };
  const result = await searchTrialsWithEligibility({ ...request, limit: 3 }, async url => {
    urls.push(String(url));
    return urls.length === 1 ? Response.json({ places: [{ latitude: "39.08", longitude: "-94.59" }] }) : Response.json({ studies: [fullStudy], nextPageToken: "next" });
  });
  assert.equal(urls[0], "https://api.zippopotam.us/us/00123");
  const query = new URL(urls[1]);
  assert.equal(query.searchParams.get("filter.geo"), "distance(39.08,-94.59,50mi)");
  assert.equal(query.searchParams.get("pageSize"), "3");
  assert.equal(query.searchParams.get("filter.overallStatus"), "RECRUITING,NOT_YET_RECRUITING");
  assert.deepEqual(result.studies, [fullStudy]);
  assert.deepEqual(result.sourceUrls, [trial.url]);
  assert.equal(result.nextPageToken, "next");
  let calls = 0;
  await assert.rejects(searchTrialsWithEligibility({ ...request, limit: 3 }, async () => {
    calls++;
    return Response.json({ places: [{ latitude: "NaN", longitude: "-94.59" }] });
  }), /resolve/);
  assert.equal(calls, 1);
});

test("HTTP interface delegates start/resume, preserves raw JSON, and rejects malformed input", async () => {
  const calls = [];
  const result = { status: "complete", report, sources: sourceRecords };
  const { POST } = load("src/app/api/research/route.ts", {
    "@/lib/medical-research": {
      startMedicalResearch: async (input, signal) => { calls.push(["start", input, signal]); return result; },
      resumeMedicalResearch: async (input, signal) => { calls.push(["resume", input, signal]); return result; },
    },
  });
  const send = body => new Request("http://localhost/api/research", { method: "POST", body: JSON.stringify(body) });
  const initial = send(request);
  const response = await POST(initial);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), result);
  assert.equal(calls[0][2], initial.signal);
  const resume = { sessionId: "example-session", answers: [] };
  await POST(send(resume));
  assert.deepEqual(calls[1].slice(0, 2), ["resume", resume]);
  const invalid = await POST(new Request("http://localhost/api/research", { method: "POST", body: "{" }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /valid JSON/);
  assert.equal(calls.length, 2);
});

test("client uses Server Functions, surfaces errors and ignores responses after cancellation", async () => {
  const controller = new AbortController();
  const packet = { status: "complete", report, sources: sourceRecords };
  let fail = false;
  let cancel = false;
  const calls = [];
  const client = load("src/lib/research-search-client.ts", {
    "@/app/actions/medical-research": {
      searchMedicalResearch: async input => {
        calls.push(input);
        if (cancel) controller.abort();
        return fail ? { success: false, error: "Source unavailable" } : { success: true, data: packet };
      },
      answerMedicalQuestions: async input => {
        calls.push(input);
        return { success: true, data: packet };
      },
    },
  });
  assert.deepEqual(await client.requestResearchSearch(request), packet);
  assert.deepEqual(calls[0], request);
  const answers = [{ id: "q1", answer: null }];
  assert.deepEqual(await client.requestMedicalAnswers("session", answers), packet);
  assert.deepEqual(calls[1], { sessionId: "session", answers });
  fail = true;
  await assert.rejects(client.requestResearchSearch(request), /Source unavailable/);
  fail = false;
  cancel = true;
  await assert.rejects(client.requestResearchSearch(request, controller.signal), { name: "AbortError" });
  const count = calls.length;
  await assert.rejects(client.requestResearchSearch(request, controller.signal), { name: "AbortError" });
  assert.equal(calls.length, count, "already cancelled requests must not invoke a Server Function");
});

test("abstract hydration keeps source text even if the model attempts to rewrite it", () => {
  const { hydrateReport } = workflow();
  const input = { ...report, trials: [{ ...trial, abstract: "Invented cure" }], research: [{ ...article, abstract: "Invented cure" }] };
  assert.deepEqual(hydrateReport(input, sourceRecords), report);
  const details = { id: "details", tool: "get-article-details", input: { pmid: article.id },
    result: { content: [{ type: "text", text: "**Abstract:**\nFull abstract from source.\n\n**Full Text:**\nUnavailable" }] } };
  const hydrated = hydrateReport({ ...input, research: [{ ...article, sourceIds: ["details"] }] }, [...sourceRecords, details]);
  assert.equal(hydrated.research[0].abstract, "Full abstract from source.");
});

test("model trial projection preserves full eligibility and summaries but omits unrelated fields and distant sites", () => {
  const { medicalModelContext } = load("src/lib/medical-model-context.ts");
  const criteria = "Inclusion:\n" + "Keep this requirement verbatim. ".repeat(1000);
  const study = JSON.parse(sourceRecords[0].result.content[0].text).studies[0];
  study.protocolSection.eligibilityModule = { eligibilityCriteria: criteria, minimumAge: "18 Years", maximumAge: "75 Years", sex: "ALL", healthyVolunteers: false };
  study.protocolSection.statusModule = { overallStatus: "RECRUITING", largeAdministrativeField: "OMIT".repeat(1000) };
  study.protocolSection.contactsLocationsModule = { locations: [
    { facility: "Nearby site", status: "RECRUITING", city: "Kansas City", state: "Missouri", country: "United States", geoPoint: { lat: 39.08, lon: -94.59 }, contacts: [{ name: "PRIVATE_CONTACT" }] },
    { facility: "Distant site", status: "RECRUITING", geoPoint: { lat: 40.71, lon: -74.0 } },
    { facility: "Unknown coordinates", status: "RECRUITING" },
  ] };
  study.protocolSection.armsInterventionsModule = { interventions: [{ type: "DRUG", name: "Example therapy", description: "UNNEEDED_DOSING_TEXT" }] };
  const payload = { studies: [study], sourceUrls: [trial.url], nextPageToken: "opaque-token",
    location: { latitude: 39.08, longitude: -94.59, zipCode: "64108", travelDistanceMiles: 100 } };
  const raw = { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  const before = JSON.stringify(raw);
  const compact = medicalModelContext("search-trials-with-eligibility", raw);
  assert.equal(JSON.stringify(raw), before, "projection must not mutate original sources");
  assert.equal(compact.trials[0].eligibility.filter(entry => entry.field === "eligibilityCriteria").map(entry => entry.text).join("\n"), criteria);
  for (const [field, value] of Object.entries(study.protocolSection.eligibilityModule)) {
    if (field !== "eligibilityCriteria") assert.equal(compact.trials[0].eligibility.find(entry => entry.field === field).text, String(value));
  }
  assert.equal(compact.trials[0].summary, trial.abstract);
  assert.equal(compact.trials[0].title, trial.title);
  assert.equal(compact.trials[0].url, trial.url);
  assert.equal(compact.trials[0].status, "RECRUITING");
  assert.deepEqual(compact.trials[0].interventions, [{ type: "DRUG", name: "Example therapy" }]);
  assert.equal(compact.trials[0].sites.length, 1);
  assert.equal(compact.trials[0].sites[0].facility, "Nearby site");
  assert.equal(compact.trials[0].sites[0].distanceMiles, 0);
  assert.deepEqual(compact.trials[0].siteCounts, { total: 3, withinRadius: 1, unknownDistance: 1 });
  for (const omitted of ["PRIVATE_CONTACT", "ADMINISTRATIVE_SENTINEL", "UNNEEDED_DOSING_TEXT", "opaque-token"]) {
    assert.equal(JSON.stringify(compact).includes(omitted), false);
  }
  assert.equal(compact.hasMore, true);
  assert.ok(JSON.stringify(compact).length < before.length / 2);
});

test("model article projection retains complete abstract and provenance without attached bodies or duplicate payloads", () => {
  const { medicalModelContext } = load("src/lib/medical-model-context.ts");
  const abstract = "Full abstract. ".repeat(1000);
  const header = `**Title:** Original title\n\n**Full Text Available:** Yes\n**Full Text URL:** https://example.org/article\n\n**Abstract:**\n${abstract}\n\n`;
  const raw = { content: [{ type: "text", text: header + "**Full Text:**\n" + "BODY_SENTINEL".repeat(1000) }],
    structuredContent: { duplicateBody: "BODY_SENTINEL".repeat(1000) } };
  const compact = medicalModelContext("get-article-details", raw);
  assert.equal(compact.parts[0].text, header.trimEnd());
  assert.equal(compact.parts[0].fullTextOmitted, true);
  assert.equal(JSON.stringify(compact).includes("BODY_SENTINEL"), false);
  const noBody = { content: [{ type: "text", text: header }] };
  assert.equal(medicalModelContext("get-article-details", noBody).parts[0].fullTextOmitted, false);
  assert.deepEqual(medicalModelContext("search-medical-literature", sourceRecords[1].result),
    { isError: false, text: sourceRecords[1].result.content[0].text });
  assert.equal(medicalModelContext("search-trials-with-eligibility", { content: [{ type: "text", text: "bad JSON" }] }).isError, true);
  assert.deepEqual(medicalModelContext("search-trials-with-eligibility", { isError: true, content: [{ type: "text", text: "Source failed" }] }),
    { isError: true, text: "Source failed" });
});

test("criterion references resolve only to original retrieved eligibility fields", () => {
  const { resolveEligibilityCriterion } = load("src/lib/medical-model-context.ts");
  const raw = sourceRecords[0].result;
  assert.equal(resolveEligibilityCriterion(raw, "NCT12345678:c0"), "Inclusion: adults age 18 or older.");
  assert.equal(resolveEligibilityCriterion(raw, "NCT99999999:c0"), undefined);
  assert.equal(resolveEligibilityCriterion({ ...raw, isError: true }, "NCT12345678:c0"), undefined);
});

test("identical repeated lookups reuse a source ID and avoid sending evidence twice", async () => env(async () => {
  const app = workflow({ repeatSearch: true });
  const first = await app.startMedicalResearch(request);
  assert.equal(first.status, "questions");
  assert.equal(app.calls.length, 2, "the repeated search must not make a third MCP request");
  assert.equal(first.sources.length, 2);
  const lastTurn = app.models[0].turns.at(-1);
  const serialized = JSON.stringify(lastTurn);
  assert.match(serialized, /"alreadyRetrieved":true/);
  assert.equal(collectSources(lastTurn).length, 2, "the original evidence must appear only once");
}));
