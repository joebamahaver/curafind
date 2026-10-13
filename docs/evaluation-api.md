# Evaluation API examples

All endpoints accept JSON via POST and return JSON after evaluation completes.
Trial scoring, study scoring, and eligibility use local Ollama decisions.
Question generation and clinical-trial ranking use Strands agents. API keys and
Ollama configuration remain on the server.

## Local evaluation configuration

Run Ollama 0.35 or later and download the decision model:

```bash
ollama pull tev1:4b
ollama serve # if Ollama is not already running
```

Configure the Next.js server's root `.env`:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
DECISIONS_MODEL=tev1:4b
DECISIONS_TIMEOUT_MS=120000
# Still needed for cloud question generation and ranking:
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
# Optional: adds Cerebras to the ranking rotation.
CEREBRAS_API_KEY=your_cerebras_api_key
```

The three local settings default to these values when omitted. The base URL
points to the Ollama server, without `/v1/systemone`; reverse-proxy path prefixes
are supported. The timeout must be a positive integer in milliseconds, up to
2147483647. `tev1:0.8b` can be selected instead. Restart Next.js after editing
`.env`. Localhost refers to the machine/container running Next.js; configure
an accessible Ollama host when deploying elsewhere.

`src/lib/local-decision-model.ts` provides `createLocalDecisionModel()`, a
stateless adapter with `invoke(state, questions, { signal })`. It posts to
`/v1/systemone` and validates each named answer. HTTP errors, malformed answers,
timeouts, and cancellation propagate; local evaluations have no cloud fallback.
Requests exceeding 64 KiB are rejected before dispatch and are not truncated.
Model context limits can also reject a request.

`evaluateTrial` submits one five-level applicability score question.
`evaluateStudy` submits applicability and efficacy questions together in one
request and returns only `{ applicableness, efficacy }`. Ollama's weighted
zero-based score (0–4) is scaled by 25 to preserve the application's 0–100 scale;
fractional values are retained. Efficacy remains an evidence rating, not a
success percentage. `evaluateEligibility` uses a `noul` question and maps its
probability of true to `eligible = probability >= 0.5`; ties remain potential
matches. Its criteria explicitly keep missing/uncertain information potentially
eligible. Probabilities do not establish confirmed eligibility.

The contract follows the official [Ollama System One API](https://docs.ollama.com/api/systemone),
[decision guide](https://docs.ollama.com/capabilities/decision), and
[Tev1 model documentation](https://ollama.com/library/tev1).

## Remaining cloud evaluation

`criterionFinder` always uses Google `gemini-3.1-flash-lite`. `rankTrials`
rotates through Groq `openai/gpt-oss-20b`, optional Cerebras `qwen-3.8-27b`,
and Google `gemini-3.1-flash-lite`. Cloud models are constructed lazily, so local
functions do not require cloud credentials. Only ranking advances this rotation.
Each cloud invocation creates a fresh agent with validated structured output.

Treatment extraction now happens in `rankTrials` alongside ranking: each item
has `treatment: string | null`, extracted from the supplied clinical-trial
interventions and metadata. Research studies no longer extract or display a
treatment field.

`/api/trialeval`, `/api/eligibility`, and the drug Server Function have no
Groq-key check. The cloud-dependent `/api/criterionfinder`, `/api/ranktrials`,
and `/api/trials/rank` retain their existing Groq-key check. Question generation
also needs `GEMINI_API_KEY`; ranking needs credentials for the selected provider.

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
| `/api/ranktrials` | `answers`, `condition`, `trials` (full trial objects) | `{ "trials": [{ "rank": 1, "explanation": "...", "treatment": "Example therapy", "trial": { ... } }] }` |

Standalone eligibility/ranking accept `{ question, answer }` pairs without IDs.
Eligibility `true` includes missing or uncertain information; a clear conflict
returns `false`. The library helper returns the boolean directly; the HTTP
route wraps it in `{ eligible }`.

Standalone ranking accepts complete `TrialSummary` objects, including
`applicableness` from 0 to 100, and preserves additional metadata. Trial IDs must
be unique. Empty input skips model invocation and returns `{ "trials": [] }`
after the route's key check. Every supplied trial must appear exactly once in
model output; the library attaches one-based ranks, a nullable treatment name, and original trial objects.

## Quick curl example and errors

Start the development server before running this example. Requests can be silent
while models run; latency depends on input and provider limits.

```bash
curl -i --max-time 120 http://localhost:3000/api/criterionfinder \
  -H 'Content-Type: application/json' \
  -d '{"condition":"Example condition","criterion":"Inclusion: adults age 18 or older. Exclusion: prior treatment with the study drug."}'
```

Malformed JSON or invalid fields return 400. Cloud-dependent evaluation routes return 500 when
their required Groq key is absent. All evaluation routes return 502 for evaluator
failures, including local Ollama connection, model, and response errors. `/api/trials`
preserves `TrialSearchError` status codes, including 400 for invalid input and
500 for invalid configured limits; other failures return 502. Responses use
`Cache-Control: no-store`.
