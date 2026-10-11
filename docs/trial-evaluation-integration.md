# Clinical trial evaluation integration

The patient pipeline is implemented in `src/lib/trial-workflow.ts`: retrieve
trials, score and shortlist them, generate questions, check answers, then rank
potential matches. See [API examples](./evaluation-api.md) and
[location search](./trial-location-search.md).

## Search and questions

1. `ResearchRequest` runs `requestResearchSearch` inside an awaited React
   transition, keeping the form loading until the selected searches finish.
2. The browser coordinator starts selected branches with `Promise.allSettled`.
   Trials use `requestTrialSearch` (`POST /api/trials`); drugs use the
   `searchAndEvaluateDrugs` Server Function. There is no combined research
   Server Function.
3. `/api/trials` validates diagnosis and location, then calls
   `searchTrialsAndMakeQuestions`. `TRIAL_SEARCH_LIMIT` controls retrieval page
   size, overriding the caller's valid `pageSize`.
4. Each retrieved trial is scored using
   `evaluateTrial(summary, title, diagnosis, conditions)`. Calls run in batches
   of at most four, each with a fresh agent. The validated `applicableness`
   score ranges from 0 to 100 and stays attached to the original metadata.
5. Trials sort by descending applicability. The top `TRIAL_SHORTLIST_LIMIT`
   trials supply their IDs, age bounds, sex, and criteria to one
   `criterionFinder` call. Each question gets a UUID `id` and a `type` of
   `number`, `yes-no`, or `string`.
6. `ResearchResultsReader` displays `TrialQuestions` in the Trials tab before
   ranking. No trials skips question generation; trials with no questions allow
   the user to continue without answers.

This evaluates one search page. `totalCount`, `nextPageToken`, `requestUrl`, and
optional `locationFilter` are preserved. `totalCount` counts all search matches,
not the shortlist. The main reader does not automatically load further pages.

## Types and result fields

`src/lib/trial-evaluation-types.ts` owns `TrialParams`, `TrialSummary`,
`TrialSearchResult`, `TrialAnswer`, `RankedTrialSummary`, and `FinalTrialResult`.
Use `import type` in browser code. `PreparedTrialSearchResult` is defined in
`src/lib/trial-workflow.ts` and adds questions to the search result.

| Stage | Trial array | Other fields |
| --- | --- | --- |
| Retrieval (`TrialSearchResult`) | `trialSums` | Retrieval and location metadata |
| Prepared search (`PreparedTrialSearchResult`) | `trialSums` | `questions` and retrieval metadata |
| Combined research (`ResearchSearchResult`) | `clinicalTrials.trialSums` | `drugResearch`, optional branch `errors` |
| Final ranking (`FinalTrialResult`) | `studies` | `evaluatedCount`, `excludedCount` |

The rename from `studies` to `trialSums` applies to retrieval and prepared
trials. The browser response check and `/api/trials/rank` request schema both
use `trialSums`. Final ranked output still uses `studies`; the standalone
`/api/ranktrials` endpoint still accepts and returns `trials`.

## Answers and final ranking

`TrialQuestions` submits `{ id, question, answer }` for every question. Answers
are numbers, booleans, strings, or `null`; blanks and "Not sure" stay unknown.
`ResearchRequest` posts `{ condition, prepared_trials: result.clinicalTrials,
answers }` to `/api/trials/rank`.

The route requires unique prepared trial/question IDs and unique answer IDs.
Answers must reference prepared questions and match their types, or be `null`.
The workflow matches answers by ID and uses the prepared question text; omitted
answers also become `null`.

Eligibility is checked sequentially against each shortlisted trial's own
criteria. `evaluateEligibility` returns a boolean: a clear conflict excludes a
trial, while missing or uncertain information remains a potential match. One
`rankTrials` call orders remaining trials and supplies explanations. Every
supplied trial must appear exactly once, with original metadata preserved.
No eligible trials skips the ranking model call.

Final `studies` contain `rank` and `explanation`. `evaluatedCount` counts
shortlisted trials checked for eligibility; `excludedCount` counts exclusions.
The reader displays one ranked trial at a time with details and a study link.
"Edit trial answers" returns to the retained form. The study team must confirm
eligibility; these results are potential matches.

## Configuration and failures

Set the following in the root `.env` and restart the server after changes:

```dotenv
TRIAL_SEARCH_LIMIT=10
TRIAL_SHORTLIST_LIMIT=3
```

The search limit accepts whole numbers from 10 to 1000; the shortlist limit
accepts 1 to 1000. Missing values default to 10 and 3. The shortlist cannot exceed
the number retrieved. See [model configuration](./evaluation-api.md) for keys.

Scoring uses `Promise.all` within each batch. An unrecovered scoring failure or
question-generation failure fails the trial branch rather than returning partial
trials. The coordinator retains the other branch's successful result and exposes
errors in `results.errors`. If neither branch succeeds, the form shows an error.

Trial HTTP requests receive an `AbortSignal`. Browser cancellation checks prevent
stale results from displaying. The drug Server Function accepts serializable
inputs only, so dispatched drug work may continue after cancellation. Ranking
requests abort when the search resets or the component unmounts. A failed answer
submission preserves the answers for retry.

## Accessing results

The optional `onResults(results, request, signal)` callback receives prepared
trials and drug results before display. Final ranking is stored separately in
`ResearchRequest` and is not passed to this initial-search callback.

```tsx
<ResearchRequest onResults={async (results, request, signal) => {
  signal.throwIfAborted();
  console.log(request.condition, {
    shortlistedTrials: results.clinicalTrials?.trialSums ?? [],
    questions: results.clinicalTrials?.questions ?? [],
    evaluatedStudies: results.drugResearch?.articles ?? [],
    displayedStudies: results.drugResearch?.topArticles ?? [],
    errors: results.errors,
  });
}} />
```

"View results JSON" includes the combined search object and current
`rankedTrials`. All successful drug evaluations remain in JSON even though only
`topArticles` appear in the reader.

## Verification

For implementation changes, run `npm test`, `npm run lint`, `npx tsc --noEmit`,
and `npm run build`. Mock retrieval and inference to avoid network dependencies
and quota. Retrieval/prepared fixtures must use `trialSums`; final ranking
fixtures must use `studies`.

Check trial-only, research-only, and combined searches; question rendering;
typed and unknown answers; ranking and answer editing; empty results; branch
failures; and cancellation followed by another search. Check desktop and mobile
layouts. The existing trial workflow fixtures still need migration from the
old retrieval field name before they can validate the current contract.
