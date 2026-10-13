import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers/load.mjs";

const input = { diagnosis: "Example", zipCode: "64108", travelDistanceMiles: 50 };
const zipResponse = { places: [{ latitude: "39.0837", longitude: "-94.5868", "place name": "Kansas City", "state abbreviation": "MO" }] };
const { searchTrialsByDiagnosis, parseDiagnosisSearch, buildClinicalTrialsUrl } = load("src/lib/clinical-trials.ts");

test("ZIP lookup happens first and the trial query applies a radius in miles before returning full JSON", async () => {
  const calls = [];
  const result = await searchTrialsByDiagnosis({ ...input, pageToken: "next-page", travelDistanceMiles: 25.5 }, {
    fetcher: async (target, options) => {
      const url = new URL(target);
      calls.push(url);
      assert.ok(options.signal instanceof AbortSignal);
      if (calls.length === 1) {
        assert.equal(url.href, "https://api.zippopotam.us/us/64108");
        return Response.json(zipResponse);
      }
      assert.equal(url.origin, "https://clinicaltrials.gov");
      assert.equal(url.searchParams.get("query.cond"), "Example");
      assert.equal(url.searchParams.get("filter.geo"), "distance(39.0837,-94.5868,25.5mi)");
      assert.equal(url.searchParams.get("filter.overallStatus"), "RECRUITING,NOT_YET_RECRUITING");
      assert.equal(url.searchParams.get("pageToken"), "next-page");
      return Response.json({ studies: [], totalCount: 0 });
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(result.locationFilter, { zipCode: "64108", travelDistanceMiles: 25.5, latitude: 39.0837, longitude: -94.5868, city: "Kansas City", state: "MO" });
  assert.equal(new URL(result.requestUrl).searchParams.get("filter.geo"), "distance(39.0837,-94.5868,25.5mi)");
  assert.deepEqual(result.trialSums, []);
});

test("ZIP leading zeros are retained and malformed locations fail before fetching", async () => {
  assert.equal(parseDiagnosisSearch({ ...input, zipCode: " 02108 " }).zipCode, "02108");
  for (const invalid of [
    { ...input, zipCode: "1234" }, { ...input, zipCode: 64108 },
    { ...input, travelDistanceMiles: 0 }, { ...input, travelDistanceMiles: -1 },
    { ...input, travelDistanceMiles: Infinity }, { ...input, travelDistanceMiles: 10001 },
    { ...input, travelDistanceMiles: "50" }, { diagnosis: "Example", zipCode: "64108" },
    { diagnosis: "Example", travelDistanceMiles: 50 },
  ]) {
    await assert.rejects(searchTrialsByDiagnosis(invalid, { fetcher: () => assert.fail("Invalid search must not fetch") }), error => error.status === 400);
  }
  assert.throws(() => buildClinicalTrialsUrl(input), /resolve the ZIP/);
  assert.equal(buildClinicalTrialsUrl({ diagnosis: "Example" }).searchParams.has("filter.geo"), false);
});

test("unknown ZIP, failed geocoding, and invalid coordinates never query ClinicalTrials.gov", async () => {
  for (const [response, status] of [
    [() => new Response(null, { status: 404 }), 400],
    [() => new Response(null, { status: 503 }), 502],
    [() => Response.json({ places: [] }), 502],
    [() => Response.json({ places: [{ latitude: "", longitude: "" }] }), 502],
    [() => Response.json({ places: [{ latitude: "91", longitude: "181" }] }), 502],
    [() => { throw new Error("Network unavailable"); }, 502],
  ]) {
    let calls = 0;
    await assert.rejects(searchTrialsByDiagnosis(input, { fetcher: async url => {
      calls++;
      assert.equal(new URL(url).hostname, "api.zippopotam.us");
      return response();
    } }), error => error.status === status);
    assert.equal(calls, 1);
  }
});

test("cancellation during ZIP resolution stops before trial retrieval", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(searchTrialsByDiagnosis(input, {
    signal: controller.signal,
    fetcher: async () => { calls++; controller.abort(); return Response.json(zipResponse); },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("the trials HTTP route requires location before dispatching the workflow", async () => {
  const calls = [];
  const { POST } = load("src/app/api/trials/route.ts", {
    "@/lib/trial-workflow": { searchTrialsAndMakeQuestions: async search => { calls.push(search); return { trialSums: [], questions: [] }; } },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const body of [{ diagnosis: "Example" }, { ...input, zipCode: "invalid" }, { ...input, travelDistanceMiles: null }]) {
      const response = await POST(new Request("http://localhost/api/trials", { method: "POST", body: JSON.stringify(body) }));
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, "string");
    }
    assert.equal(calls.length, 0);
    const response = await POST(new Request("http://localhost/api/trials", { method: "POST", body: JSON.stringify(input) }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].zipCode, input.zipCode);
    assert.equal(calls[0].travelDistanceMiles, input.travelDistanceMiles);
  } finally {
    console.error = originalError;
  }
});
