# Drug evaluation flow

The form's drug checkbox invokes `searchAndEvaluateDrugs` in
`src/app/actions/drug-research.ts`. This Next.js Server Function directly calls
the same PubMed helpers used by `/api/drugs`: `searchDrugResearch`,
`getArticleDetails`, and `readPubMedArticles`. It does not fetch an internal API.

Configure the limits in the root `.env`:

```dotenv
DRUG_EVAL_LIMIT=5
DRUG_DISPLAY_LIMIT=2
```

Both settings must be positive whole numbers. Missing settings default to 5
and 2. Restart a running server after changing `.env`.

The flow takes the first available abstracts in the search's returned order,
up to `DRUG_EVAL_LIMIT`. Studies without abstracts are skipped. Each selected
study is passed to `evaluateStudy(condition, abstract)`, which creates a fresh
agent. Its `treatment`, `applicableness`, and `efficacy` are added to the original
article JSON. Scores are estimates from abstracts, not treatment success rates.
`treatment` can identify a drug, supplement, behavioral therapy, procedure, or
another intervention; it is `null` if none is identified in the abstract.

Results sort by descending `applicableness`, then descending `efficacy` to break
ties. `articles` contains all successful evaluations; `topArticles` contains up
to `DRUG_DISPLAY_LIMIT` studies for the browser. `ResearchResultsReader` places
them in the Research tab and displays one study at a time with Previous/Next
controls. The raw results JSON retains all successful `articles`.

Model selection is shared with the trial evaluators in `src/lib/evaltools.ts`.
See [Evaluation API examples](./evaluation-api.md) for the current Google and
optional Cerebras pool and required server credentials. The drug Server Function
still checks for `GROQ_API_KEY` before retrieval, even when another provider is
selected. Drug evaluations use `Promise.allSettled`, independently of the trial
pipeline's batches of four.

If an individual evaluation fails, successful results still display and
`failedCount` reports how many failed. If every attempted evaluation fails, the
form displays a retry error. Cancelling prevents stale results from updating
the browser; a dispatched Server Function may still finish its server work.
When both search options are selected, a failure in one search does not discard
the other's results. The browser shows the successful results and an error for
the failed search; that error is also available in `results.errors`.

The component's existing `onResults` callback receives the scored JSON:

```tsx
<ResearchRequest onResults={async (results, request) => {
  const evaluatedStudies = results.drugResearch?.articles ?? [];
  const displayedStudies = results.drugResearch?.topArticles ?? [];
  console.log(request.condition, evaluatedStudies, displayedStudies);
}} />
```

Run the deterministic tests with `npm test`. They mock PubMed and inference;
they do not start a server or spend API quota.
