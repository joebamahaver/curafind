# Add evaluated trials alongside drug results

This is an implementation guide, not an implemented trial pipeline. Follow the
existing [drug evaluation flow](./drug-evaluation.md): retrieve candidates,
evaluate a configurable subset, preserve their metadata, rank them, and display
a smaller subset. Keep trial and drug results in separate JSON fields.

## Existing pieces

- `src/lib/clinical-trials.ts` exports `searchTrialsByDiagnosis(input)` and the
  `TrialSummary` / `TrialSearchResult` types. Each trial already contains its ID,
  title, summary, URL, and eligibility criteria.
- `src/lib/evaltools.ts` currently exports
  `evaluateTrial(summary, title, condition)`, returning `{ applicableness }`.
- `src/app/actions/drug-research.ts` exports `searchAndEvaluateDrugs(condition)`.
- `src/lib/research-search-client.ts` coordinates the selected search paths.
- `src/components/research-request.tsx` owns the loading flow, displays results,
  and passes the complete JSON to its `onResults` callback.

The teammate's evaluator can replace the evaluation call below. Prefer a separate
module such as `src/lib/trial-evaluation.ts` to avoid conflicts with study logic.
Agree on its input/output types before wiring it in. Preserve the spelling
`applicableness` while that is the application's score field, and validate scores
as numbers from 0 to 100. Every independent evaluation should create a fresh agent.

## 1. Define the trial result contract

Create `src/lib/trial-evaluation-types.ts`. Keep these types outside a
`"use server"` file so browser code can import them with `import type`.

```ts
import type { TrialSearchResult, TrialSummary } from "./clinical-trials";

export type EvaluatedTrial = TrialSummary & {
  applicableness: number;
};

export type TrialResearchResult = Omit<TrialSearchResult, "studies"> & {
  diagnosis: string;
  trialsSearched: number;
  evaluatedCount: number;
  failedCount: number;
  evaluationLimit: number;
  displayLimit: number;
  studies: EvaluatedTrial[];
  topStudies: EvaluatedTrial[];
};

export type TrialEvaluationActionResult =
  | { success: true; data: TrialResearchResult }
  | { success: false; error: string };
```

`studies` contains all successful evaluations from the selected candidates;
`topStudies` is the display subset. Keep original IDs and metadata. Preserve
`nextPageToken`, `requestUrl`, and `totalCount` from retrieval: `totalCount` is the
search's total matching trials, not the number evaluated. `trialsSearched` counts
the trials retrieved on this page. This first version evaluates one page only.

## 2. Add the trial Server Function

Create `src/app/actions/trial-research.ts` with `"use server"` at the top. Import
`searchTrialsByDiagnosis` directly rather than fetching `/api/trials` or calling
`requestTrialSearch`, which is the browser HTTP adapter.

Example using the current evaluator:

```ts
"use server";

import { z } from "zod";
import { searchTrialsByDiagnosis } from "@/lib/clinical-trials";
import type { TrialEvaluationActionResult } from "@/lib/trial-evaluation-types";

function readLimit(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`${name} must be a positive whole number.`);
  }
  return limit;
}

export async function searchAndEvaluateTrials(
  condition: string,
): Promise<TrialEvaluationActionResult> {
  const input = z.string().trim().min(1).max(200).safeParse(condition);
  if (!input.success) {
    return { success: false, error: "Enter a condition between 1 and 200 characters." };
  }

  try {
    const evaluationLimit = readLimit("TRIAL_EVAL_LIMIT", 5);
    const displayLimit = readLimit("TRIAL_DISPLAY_LIMIT", 2);
    if (!process.env.GROQ_API_KEY) {
      return { success: false, error: "GROQ_API_KEY is not configured." };
    }

    const retrieved = await searchTrialsByDiagnosis({
      diagnosis: input.data,
      recruitment: "recruiting-or-upcoming",
      // This is one search page; evaluationLimit caps inference separately.
      pageSize: 10,
    });
    const candidates = retrieved.studies
      .filter(trial => trial.summary.trim().length > 0)
      .slice(0, evaluationLimit);

    const evaluations = candidates.length > 0
      ? await Promise.allSettled(candidates.map(async trial => {
          const { evaluateTrial } = await import("@/lib/evaltools");
          const score = await evaluateTrial(trial.summary, trial.title, input.data);
          return { ...trial, applicableness: score.applicableness };
        }))
      : [];

    const studies = evaluations.flatMap(result =>
      result.status === "fulfilled" ? [result.value] : []);
    const failedCount = evaluations.length - studies.length;
    for (const result of evaluations) {
      if (result.status === "rejected") {
        console.error("Trial evaluation failed:", result.reason);
      }
    }
    if (candidates.length > 0 && studies.length === 0) {
      return { success: false, error: "No trials could be evaluated. Please retry." };
    }

    studies.sort((a, b) => b.applicableness - a.applicableness);
    return {
      success: true,
      data: {
        ...retrieved,
        diagnosis: input.data,
        trialsSearched: retrieved.studies.length,
        evaluatedCount: studies.length,
        failedCount,
        evaluationLimit,
        displayLimit,
        studies,
        topStudies: studies.slice(0, displayLimit),
      },
    };
  } catch (error) {
    console.error("Trial research evaluation failed:", error);
    return { success: false, error: "Trial research evaluation failed. Please retry." };
  }
}
```

For the teammate's implementation, change the evaluator import and invocation to
its agreed interface. Attach explicitly validated fields to the original trial;
do not let model output replace its ID, title, or URL. If more scoring fields are
added, extend `EvaluatedTrial` and decide the tie-break rule together.

Add these defaults to `.env.example` and your local `.env`:

```dotenv
TRIAL_EVAL_LIMIT=5
TRIAL_DISPLAY_LIMIT=2
```

The evaluation limit applies before any model calls. With a page size of 10,
increasing the limit above 10 will not retrieve additional trials automatically.
Restart the server after changing environment variables. Keep the Groq key on
the server and reuse the existing configured provider.

## 3. Run both branches concurrently on the server

Do not call two Server Actions from the browser and assume `Promise.allSettled`
makes them execute concurrently. This installed Next.js version dispatches Server
Actions one at a time per client. See the bundled guide at
`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`.

Create one entry point, `src/app/actions/research-search.ts`, that invokes both
functions directly on the server. The browser makes one Server Function call;
`Promise.allSettled` inside it runs the selected backend branches concurrently.
These are ordinary direct calls when invoked on the server, not internal HTTP
requests.

First create `src/lib/research-search-types.ts` to hold the shared result type:

```ts
import type { TrialResearchResult } from "./trial-evaluation-types";
import type { DrugResearchResult } from "./drug-evaluation-types";

export type ResearchSearchResult = {
  clinicalTrials: TrialResearchResult | null;
  drugResearch: DrugResearchResult | null;
  errors?: { clinicalTrials?: string; drugResearch?: string };
};

export type ResearchSearchActionResult =
  | { success: true; data: ResearchSearchResult }
  | { success: false; error: string };
```

Example orchestration:

```ts
"use server";

import { z } from "zod";
import { searchAndEvaluateTrials } from "./trial-research";
import { searchAndEvaluateDrugs } from "./drug-research";
import type { ResearchSearchActionResult, ResearchSearchResult }
  from "@/lib/research-search-types";

const requestSchema = z.object({
  condition: z.string().trim().min(1).max(200),
  clinicalTrials: z.boolean(),
  offLabelDrugsOrSupplements: z.boolean(),
}).refine(value => value.clinicalTrials || value.offLabelDrugsOrSupplements);

export async function searchAndEvaluateResearch(
  request: unknown,
): Promise<ResearchSearchActionResult> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) {
    return { success: false, error: "Enter a condition and select a search option." };
  }
  const input = parsed.data;
  const [trialResult, drugResult] = await Promise.allSettled([
    input.clinicalTrials ? searchAndEvaluateTrials(input.condition) : null,
    input.offLabelDrugsOrSupplements ? searchAndEvaluateDrugs(input.condition) : null,
  ]);

  const trials = trialResult.status === "fulfilled" ? trialResult.value : null;
  const drugs = drugResult.status === "fulfilled" ? drugResult.value : null;
  const clinicalTrials = trials?.success ? trials.data : null;
  const drugResearch = drugs?.success ? drugs.data : null;
  const errors: NonNullable<ResearchSearchResult["errors"]> = {};
  if (input.clinicalTrials && !clinicalTrials) {
    errors.clinicalTrials = trials && !trials.success
      ? trials.error : "Clinical trial search failed. Please retry.";
  }
  if (input.offLabelDrugsOrSupplements && !drugResearch) {
    errors.drugResearch = drugs && !drugs.success
      ? drugs.error : "Drug research search failed. Please retry.";
  }
  if (!clinicalTrials && !drugResearch) {
    return { success: false, error: Object.values(errors).join(" ") };
  }
  return {
    success: true,
    data: {
      clinicalTrials,
      drugResearch,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    },
  };
}
```

An empty successful search still returns its result object. One failed branch
must not discard the other's successful result. Keep both errors available in
JSON and visible in the form. This example waits for both branches before showing
the completed results, matching the current form behavior.

## 4. Wire the browser adapter and result cards

In `src/lib/research-search-client.ts`, re-export `ResearchSearchResult` from the
new shared types file and replace the body of `requestResearchSearch` with the
single orchestration call. Keep its browser validation and cancellation checks:

```ts
// Import searchAndEvaluateResearch from @/app/actions/research-search.
signal?.throwIfAborted();
const result = await searchAndEvaluateResearch(request);
signal?.throwIfAborted();
if (!result.success) throw new Error(result.error);
return result.data;
```

Do not pass `AbortSignal` across the Server Function boundary. Cancellation
prevents old results from updating the browser, but dispatched server work can
continue. Keep `ResearchRequest`'s existing `startTransition` and awaited promise
so the loading animation stops on success or error. Keep the final aborted check
after `onResults` as well.

Leave `requestTrialSearch`, `/api/trials`, and their existing types intact for
other callers such as the playground. The optional `fetcher` argument on
`requestResearchSearch` was for the old HTTP trial path; update its tests and
callers if removing it. The new combined flow should mock the orchestration
Server Function instead of expecting a browser fetch to `/api/trials`.

Create `src/components/trial-research-results.tsx`, following
`drug-research-results.tsx`. Use shadcn cards and Tailwind classes. Render
`result.topStudies`, with a linked trial title, its summary, and a smaller
applicableness score. Show the empty state and `failedCount` when applicable.
Describe the score as relevance to the condition; it does not confirm eligibility.

In `ResearchRequest`, render both components as sibling sections:

```tsx
{result.clinicalTrials && <TrialResearchResults result={result.clinicalTrials} />}
{result.drugResearch && <DrugResearchResults result={result.drugResearch} />}
```

If desired, place those siblings in `grid gap-6 lg:grid-cols-2` for two columns
on large screens and a vertical stack on mobile. Keep the status, per-branch
errors, pagination notice, and raw JSON outside that grid. Change the clinical
status count to `evaluatedCount` so its label reads "evaluated clinical trials".

## 5. Intercept the JSON

The existing `onResults` callback remains the integration point. This example
belongs in a Client Component because it passes a function prop:

```tsx
<ResearchRequest onResults={async (results, request, signal) => {
  const allEvaluatedTrials = results.clinicalTrials?.studies ?? [];
  const displayedTrials = results.clinicalTrials?.topStudies ?? [];
  const allEvaluatedStudies = results.drugResearch?.articles ?? [];
  const displayedStudies = results.drugResearch?.topArticles ?? [];

  // Further processing can use these arrays directly, without JSON.parse.
  // Pass signal to any additional browser fetch and check it before updating UI.
  console.log(request.condition, {
    allEvaluatedTrials, displayedTrials, allEvaluatedStudies, displayedStudies,
    errors: results.errors,
  });
}} />
```

Only use `JSON.stringify(results)` when sending or saving a JSON string. The
callback already receives a plain object, and the existing "View results JSON"
section will include both evaluated branches automatically.

## 6. Verify the integration before merging

Extend `tests/drug-evaluation.test.mjs` or add an equivalent trial test file.
Mock retrieval and inference so tests do not depend on network or spend quota.
Cover:

- Trial-only, drug-only, and both selected; unchecked branches never run.
- Both selected branches start before either finishes, inside the server entry point.
- Evaluation and display limits; no model calls beyond the configured cap.
- Scores remain attached to the original trial IDs and metadata; ranking is correct.
- Missing summaries and no matches return a successful empty result.
- Individual evaluation failures retain successful trials; all attempted failures
  return a retry error.
- Either search branch can fail without discarding the other branch's JSON.
- Invalid input, environment limits, and missing provider key fail cleanly.
- Cancellation followed by a new search cannot display stale results.
- Trial cards render only `topStudies`; raw JSON retains all evaluated `studies`.
- Existing trial HTTP endpoints, playground, and drug evaluation tests still pass.

Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
Then check the form in the browser on desktop and mobile. Merge the teammate's
evaluator first or bring it into the integration branch; resolve shared files
deliberately rather than replacing `evaltools.ts` or `research-request.tsx` wholesale.

If the teammate is also implementing eligibility questions, that is a separate
interaction after retrieval: gather answers, evaluate each trial's own criteria,
then rank remaining trials. Do not call answer-dependent eligibility logic at
initial form submission, before answers exist.
