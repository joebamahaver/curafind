# Evaluation API examples

All endpoints accept JSON via POST and return JSON after evaluation completes.
Each evaluator invocation creates a fresh Strands agent with validated structured
output. API keys remain on the server.

## Current model configuration

`src/lib/evaltools.ts` controls selection. In the current working tree, trial
scoring, drug scoring, eligibility, and ranking rotate through Cerebras
`qwen-3.8-27b` (when `CEREBRAS_API_KEY` is set) and Google
`gemini-3.1-flash-lite`. Without Cerebras credentials, the pool contains only
Google. Question generation always uses Google `gemini-3.1-flash-lite`.

Groq `openai/gpt-oss-20b` is a trial-scoring fallback: a Google error containing
`Incomplete JSON segment at the end` triggers one Groq retry. Other errors
propagate. Groq is currently outside the rotating pool. The Groq and Cerebras
OpenAI-compatible configurations use low reasoning effort.

```dotenv
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
# Optional: enables Cerebras in the rotating pool.
CEREBRAS_API_KEY=your_cerebras_api_key
```

The installed Strands Google adapter reads `GEMINI_API_KEY`. Evaluation routes
and the drug Server Function still explicitly require `GROQ_API_KEY`, even when
another provider is selected. `/api/trials` has no explicit Groq key check, but
its model calls require the selected providers' credentials. Restart after
configuration changes. The standalone `src/lib/strands.ts` example has its own
Groq configuration.

## Patient workflow endpoints

| Endpoint | Request fields | Response |
| --- | --- | --- |
| `/api/trials` | `diagnosis`, `zipCode`, `travelDistanceMiles`; optional recruitment and pagination fields | `trialSums`, `questions`, and retrieval metadata |
| `/api/trials/rank` | `condition`, `prepared_trials: { trialSums, questions }`, `answers` | `{ studies: [...], evaluatedCount, excludedCount }` |

`/api/trials` already scores and shortlists trials and generates questions. Use
those questions directly. See the [integration guide](./trial-evaluation-integration.md)
for limits and UI behavior.

```js
async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

const condition = "Your initial condition";
const prepared = await postJson("/api/trials", {
  diagnosis: condition,
  zipCode: "64108",
  travelDistanceMiles: 50,
});
console.log(prepared.trialSums, prepared.questions); // Display the questions.

// Populate this map with actual user answers, keyed by returned question ID.
// An empty map illustrates unanswered questions.
const answersById = new Map();
const answers = prepared.questions.map(({ id, question }) => ({
  id,
  question,
  answer: answersById.get(id) ?? null,
}));

// Submit after collecting the user's answers.
const ranked = await postJson("/api/trials/rank", {
  condition,
  prepared_trials: prepared,
  answers,
});
console.log(ranked.studies, ranked.evaluatedCount, ranked.excludedCount);
```

Prepared searches use **`trialSums`**; final ranking uses **`studies`**. Checking
for `studies` in the initial response rejects it before questions can render.

Questions contain `id`, `question`, and `type` (`number`, `yes-no`, or `string`).
Combined ranking answers contain `id`, `question`, and `answer`. Values must
match the question type: number, boolean, or string respectively; `null` means
unknown. Answer IDs must be unique and reference prepared questions. Omitted
answers remain unknown. Prepared trial and question IDs must also be unique.

## Standalone evaluation endpoints

These expose individual stages; the patient flow uses the combined endpoints.

| Endpoint | Request fields | Response |
| --- | --- | --- |
| `/api/trialeval` | `summary`, `title`, `condition`, optional `trial_conditions` string array (defaults to `[]`) | `{ "applicableness": 72 }` (illustrative) |
| `/api/criterionfinder` | `criterion` (combined eligibility string), `condition` | `{ "questions": [{ "id": "generated-uuid", "question": "How old are you?", "type": "number" }] }` |
| `/api/eligibility` | `answers`, `condition`, `criterion` (one trial) | `{ "eligible": true }` or `{ "eligible": false }` |
| `/api/ranktrials` | `answers`, `condition`, `trials` (full trial objects) | `{ "trials": [{ "rank": 1, "explanation": "...", "trial": { ... } }] }` |

Standalone eligibility/ranking accept `{ question, answer }` pairs without IDs.
Eligibility `true` includes missing or uncertain information; a clear conflict
returns `false`. The library helper returns the boolean directly; the HTTP
route wraps it in `{ eligible }`.

Standalone ranking accepts complete `TrialSummary` objects, including
`applicableness` from 0 to 100, and preserves additional metadata. Trial IDs must
be unique. Empty input skips model invocation and returns `{ "trials": [] }`
after the route's key check. Every supplied trial must appear exactly once in
model output; the library attaches one-based ranks and original trial objects.

## Quick curl example and errors

Start the development server before running this example. Requests can be silent
while models run; latency depends on input and provider limits.

```bash
curl -i --max-time 120 http://localhost:3000/api/criterionfinder \
  -H 'Content-Type: application/json' \
  -d '{"condition":"Example condition","criterion":"Inclusion: adults age 18 or older. Exclusion: prior treatment with the study drug."}'
```

Malformed JSON or invalid fields return 400. Evaluation routes return 500 when
their required Groq key is absent and 502 for evaluator failures. `/api/trials`
preserves `TrialSearchError` status codes, including 400 for invalid input and
500 for invalid configured limits; other failures return 502. Responses use
`Cache-Control: no-store`.
