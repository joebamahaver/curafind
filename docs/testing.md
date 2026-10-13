# Testing

Use the existing Node test runner; no additional test dependencies are needed.
Run from the repository root with Node.js 22.6 or later and installed project
dependencies:

```bash
npm test
npm run test:eval
node --experimental-strip-types --test tests/evaltools.test.mjs
```

`test:eval` selects the evaluator, evaluation API, and trial workflow suites.
`npm test` also runs location search, drug research, browser coordination,
result rendering, and trial search client tests. Tests require no API keys,
network access, or running Next.js server. Mocked provider failures are deliberate
test inputs. Some source functions still log their model selection during tests.

| File | Coverage |
| --- | --- |
| `tests/evaltools.test.mjs` | All five public evaluators: serialized inputs, structured output validation, score boundaries, nullable treatments, typed questions with unique UUIDs, eligibility booleans, complete ranking IDs, original metadata, provider errors, and model selection. |
| `tests/evaluation-api.test.mjs` | The five evaluation POST handlers: input normalization, response shapes, malformed JSON, invalid fields, missing keys, provider failures, no-store headers, unique IDs, typed answers, and metadata preservation. |
| `tests/trial-workflow.test.mjs` | Scoring concurrency and shortlist limits, Google stream fallback, cancellation, canonical prepared question text, missing answers, sequential eligibility checks, exclusions and ranking. |
| `tests/trial-search-client.test.mjs` | JSON request/response contract, cancellation signal forwarding, preserved metadata, unreadable responses, service errors and network failures. |
| `tests/clinical-trials-location.test.mjs` | ZIP lookup and radius filtering, invalid locations, geocoding failures, cancellation, and trial search route validation. |
| `tests/drug-evaluation.test.mjs` | Evaluation/display limits, partial failures, drug Server Function calls, result rendering, independent search branches, input validation and cancellation. |

`tests/helpers/load.mjs` transpiles real TypeScript modules in memory and resolves
relative imports and `@/` aliases. It substitutes only explicitly supplied mocks;
Zod validation and application logic run normally. Each top-level `load()` gets a
fresh module cache so the model rotation does not leak between test cases. Use
`withEnv()` to restore environment variables after credential/configuration
tests. Keep tests that mutate the environment sequential within each file.
`tests/helpers/fixtures.mjs` supplies full trial metadata and typed questions.

When implementing a decisions API backend, preserve the public evaluator
contracts exercised here. Replace the SDK boundary mocks with the new decision
client or transport mock as appropriate. Keep output validation, provider error,
ranking integrity, and endpoint tests; add success, malformed response, and
failure cases for the new adapter. Provider-specific rotation/fallback tests
should change if that behavior changes deliberately. Prepared searches use
`trialSums`; final patient ranking responses use `studies`.

These tests verify application behavior with controlled outputs. They do not
measure model quality or exercise a real provider or browser interaction.
TypeScript transpilation in the test loader does not type-check source; run
`npx tsc --noEmit` separately, along with `npm run lint` and `npm run build` for
implementation changes.
