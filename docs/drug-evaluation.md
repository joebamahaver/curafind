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
agent. Its `drugName`, `applicableness`, and `efficacy` are added to the original
article JSON. Scores are estimates from abstracts, not treatment success rates.

Results sort by descending `applicableness`, then descending `efficacy` to break
ties. `articles` contains all successful evaluations; `topArticles` contains up
to `DRUG_DISPLAY_LIMIT` studies for the browser. The configurable limits replace
the initial 25-result defaults in the drug section of `clankereval.md`.

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
