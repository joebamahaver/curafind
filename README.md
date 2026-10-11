# CuraFind

This is a project for HackMidwest 2026: finding clinical trials and off label drug therapies for rare conditions. Given a patient with a diagnosis, they may be interested in more options such a clinical trial or a very new drug. However, these are very hard to find with thousands of clinical trials currently going on and papers constantly being published. CuraFind is a tool to help find *relevant* trials that one could qualify for as well as find new drugs that could possibly work.

None of the claims made by this are to be taken as fact or replace the advice of a medical professional. It *is* supposed to help the search to get better though.

## Tech Stack/Architecture

### Application stack

| Layer | Implementation |
| --- | --- |
| Frontend | Next.js 16 App Router, React 19, and TypeScript; Tailwind CSS 4 with shadcn/Base UI components and Lucide icons. |
| Backend | Next.js Route Handlers for trial search and eligibility/ranking, plus a Server Action for the homepage's drug-research flow. External API requests and model calls run on the server. |
| Research sources | ClinicalTrials.gov v2 for trial records; PubMed E-utilities for research articles; EBI's Ontology Lookup Service with MONDO for disease names and synonyms. |
| AI execution | AWS Strands Agents TypeScript SDK (`@strands-agents/sdk`) for task-specific agents and model adapters. Zod defines and validates structured outputs. |
| Article parsing | `fast-xml-parser` extracts abstracts and chemical metadata from PubMed XML. |

The browser starts the selected trial and drug searches concurrently. It waits
for both to settle, preserving successful results if the other search fails.
Search results and eligibility answers are held in React state; the current
flow has no database-backed patient profile or saved-search storage.

### How we use AWS Strands

The evaluators in `src/lib/evaltools.ts` create a fresh Strands `Agent` for each
task, supplying a model adapter, a task-specific `systemPrompt`, and a Zod
`structuredOutputSchema`. The application calls `agent.invoke()` with the
condition and relevant research data, then validates `result.structuredOutput`
before using it. Separate agents keep prior evaluations out of the next task's
conversation history.

Strands supports five evaluation steps in CuraFind:

| Function | Structured result used by the application |
| --- | --- |
| `evaluateTrial` | An applicability score for a trial and condition. |
| `criterionFinder` | Patient-facing eligibility questions with number, yes/no, or text answer types; the application assigns question IDs. |
| `evaluateEligibility` | A potential-eligibility boolean for one trial, based on its criteria and the patient's answers. Missing or uncertain information does not by itself exclude a trial. |
| `rankTrials` | An ordered list of trial IDs and explanations. The application checks that every supplied trial appears exactly once and reattaches its original metadata. |
| `evaluateStudy` | A drug name, applicability score, and estimated efficacy rating from an article abstract. |

Most evaluations use Strands' `OpenAIModel` adapter with Groq. When `CEREBRAS_API_KEY` is configured, a shared round-robin
selector also uses Cerebras' models. Question generation uses Strands'
`GoogleModel` adapter with their models.

Strands provides the agent invocation and structured-output interface; the
TypeScript application controls retrieval, batching, selection, and the order
of evaluation steps. Research APIs are called directly by application code,
rather than exposed as agent tools. The current provider configuration calls
Groq, Cerebras, and Google directly.

![flow diagram](./public/curafindflow.png)

## How to Use/Run

- Clone the repo down
- Setup API keys with providers based on `.example.env`.
- `cd` into the repo and run `npm install` to install dependencies
- Run `npm run build` to build for production
- Run `npm run start` to start the production build
- Navigate to [localhost:3000](http://localhost:3000) to start using CuraFind
