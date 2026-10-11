# Evaluation API examples

All endpoints accept JSON via POST and use the server's `GEMINI_API_KEY`.
Run these examples after you start your development server yourself.

These routes return JSON after the agent finishes, so curl can be silent while
Gemini processes the request. The evaluators use `LOW` thinking effort to reduce
latency, but requests can still take tens of seconds. Use `curl -i --max-time 120`
to show response headers and allow up to two minutes for a test request.

| Endpoint | Request fields | Response |
| --- | --- | --- |
| `/api/trialeval` | `summary`, `title`, `condition` | `{ "applicableness": 72 }` (illustrative score) |
| `/api/criterionfinder` | `criterion` (combined eligibility string), `condition` | `{ "questions": [{ "question": "How old are you?", "type": "number" }] }` |
| `/api/eligibility` | `answers`, `condition`, `criterion` (one trial) | `{ "eligible": true }` or `{ "eligible": false }` |
| `/api/ranktrials` | `answers`, `condition`, `trials` (full trial objects) | `{ "trials": [{ "rank": 1, "explanation": "...", "trial": { ... } }] }` |

Questions use `number`, `yes-no`, or `string`. Answer objects contain
`question` and `answer`; answers can be a number, boolean, string, or `null`.
Eligibility `true` means a potential match, including unresolved requirements,
as defined by your current evaluator.

## Browser example

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

// Use the initial condition and full studies from your search results.
const condition = "Your initial condition";
const { studies } = await postJson("/api/trials", { diagnosis: condition });

// Optional: evaluate an individual study's applicability.
if (studies.length > 0) {
  const score = await postJson("/api/trialeval", {
    summary: studies[0].summary,
    title: studies[0].title,
    condition,
  });
  console.log(score.applicableness);
}

// One question-generation call for the combined eligibility text.
const criterion = studies.map(({ eligibility }) => [
  `Minimum age: ${eligibility.minimumAge}`,
  `Maximum age: ${eligibility.maximumAge}`,
  `Sex eligibility: ${eligibility.sex}`,
  eligibility.criteria,
].join("\n")).join("\n\n---\n\n");

if (criterion.trim()) {
  const { questions } = await postJson("/api/criterionfinder", {
    criterion,
    condition,
  });
  console.log(questions); // Render these in your form.
}

// After the user submits, use their actual question/answer pairs.
// This is an example shape; do not substitute these for their answers.
const answers = [{ question: "How old are you?", answer: 42 }];

// Evaluate each trial with the same answers, retaining the original metadata.
const matchingTrials = [];
for (const trial of studies) {
  const { eligible } = await postJson("/api/eligibility", {
    answers,
    condition,
    criterion: [
      `Minimum age: ${trial.eligibility.minimumAge}`,
      `Maximum age: ${trial.eligibility.maximumAge}`,
      `Sex eligibility: ${trial.eligibility.sex}`,
      trial.eligibility.criteria,
    ].join("\n"),
  });
  if (eligible) matchingTrials.push(trial);
}

// One ranking call containing all matching trials and their full metadata.
const { trials: rankedTrials } = await postJson("/api/ranktrials", {
  answers,
  condition,
  trials: matchingTrials,
});
console.log(rankedTrials);
```

The ranking endpoint accepts the complete `TrialSummary` objects returned by
`/api/trials`. Additional trial metadata is preserved. Trial IDs must be unique;
an empty trials array returns `{ "trials": [] }` without a model invocation.

## Quick curl example

```bash
curl -i --max-time 120 http://localhost:3000/api/criterionfinder \
  -H 'Content-Type: application/json' \
  -d '{"condition":"Example condition","criterion":"Inclusion: adults age 18 or older. Exclusion: prior treatment with the study drug."}'
```

Malformed JSON or invalid fields return HTTP 400. A missing server API key
returns HTTP 500. An evaluator failure returns HTTP 502.
