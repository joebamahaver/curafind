import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers/load.mjs";
import { trial, questions } from "./helpers/fixtures.mjs";

const { requestTrialSearch } = load("src/lib/trial-search-client.ts");
const input = { diagnosis: "Example", zipCode: "02108", travelDistanceMiles: 25 };

test("trial client sends JSON and forwards cancellation while preserving prepared metadata", async () => {
  const signal = new AbortController().signal;
  const payload = { trialSums: [trial()], questions, totalCount: 100, nextPageToken: "cursor", extra: { retained: true } };
  const result = await requestTrialSearch(input, signal, async (url, options) => {
    assert.equal(url, "/api/trials");
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(options.body), input);
    assert.equal(options.signal, signal);
    return Response.json(payload);
  });
  assert.deepEqual(result, payload);
});

test("trial client distinguishes unreadable, failed and unexpected responses", async () => {
  for (const [response, message] of [
    [() => new Response("not JSON"), /unreadable response/],
    [() => Response.json({ error: "Provider unavailable" }, { status: 502 }), /Provider unavailable/],
    [() => Response.json({ error: {} }, { status: 502 }), /Search failed/],
    [() => Response.json(null), /unexpected response/],
    [() => Response.json({ studies: [] }), /unexpected response/],
    [() => Response.json({ trialSums: {} }), /unexpected response/],
  ]) {
    await assert.rejects(requestTrialSearch(input, undefined, async () => response()), message);
  }
});

test("trial client preserves network and abort errors", async () => {
  for (const failure of [new Error("Network failed"), new DOMException("Cancelled", "AbortError")]) {
    await assert.rejects(requestTrialSearch(input, undefined, async () => { throw failure; }), error => error === failure);
  }
});
