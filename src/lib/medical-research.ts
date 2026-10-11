import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Agent, BeforeModelCallEvent, InterruptResponseContent, tool, type JSONValue, type Snapshot } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { connectMedicalMcp } from "./medical-mcp.ts";
import { MEDICAL_SYSTEM_PROMPT } from "./medical-system-prompt.ts";
import { medicalModelContext, resolveEligibilityCriterion } from "./medical-model-context.ts";
import {
  medicalRequestSchema, medicalReportSchema, medicalAgentReportSchema, questionBatchSchema, questionSchema, resumeSchema,
  type MedicalRequest, type MedicalResearchResult, type EligibilityQuestion, type SourceRecord,
} from "./medical-research-types.ts";

export const MODEL_ID = process.env.CEREBRAS_MODEL?.trim() || "gpt-oss-120b";
const SESSION_TTL = 30 * 60 * 1000;
type Session = {
  request: MedicalRequest;
  sources: SourceRecord[];
  snapshot?: Snapshot;
  questions: EligibilityQuestion[];
  interruptId?: string;
  expiresAt: number;
  busy: boolean;
};
// Shared by the Server Functions and route handler within this Node process.
const runtime = globalThis as typeof globalThis & { curafindMedicalSessions?: Map<string, Session> };
const sessions = runtime.curafindMedicalSessions ??= new Map<string, Session>();

function limit(name: string, fallback: number, maximum: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be a whole number between 1 and ${maximum}.`);
  }
  return value;
}

function pruneSessions() {
  for (const [id, session] of sessions) {
    if (session.expiresAt < Date.now() && !session.busy) sessions.delete(id);
  }
}

function evidenceText(value: unknown): string {
  if (typeof value === "string") {
    try { return evidenceText(JSON.parse(value)); }
    catch { return value; }
  }
  if (Array.isArray(value)) return value.map(evidenceText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(evidenceText).join("\n");
  return String(value ?? "");
}

function failedSource(source: SourceRecord) {
  return Boolean(source.result && typeof source.result === "object" && "isError" in source.result && source.result.isError);
}

/** Keep original source text out of the model's generated result fields. */
export function hydrateReport(input: unknown, sources: SourceRecord[]) {
  const report = medicalAgentReportSchema.parse(input);
  function abstract(id: string, sourceIds: string[]): string | null {
    const cited = sources.filter(source => sourceIds.includes(source.id) && !failedSource(source));
    for (const source of cited) {
      if (source.tool !== "search-trials-with-eligibility") continue;
      const result = source.result as { content?: Array<{ text?: string }> };
      for (const content of result.content ?? []) {
        try {
          const payload = JSON.parse(content.text ?? "");
          const study = payload.studies?.find((item: { protocolSection?: { identificationModule?: { nctId?: string } } }) =>
            item.protocolSection?.identificationModule?.nctId === id);
          if (study) return study.protocolSection.descriptionModule?.briefSummary ?? null;
        } catch { /* Non-JSON MCP content is not a full trial protocol. */ }
      }
    }
    for (const source of cited) {
      const text = evidenceText(source.result);
      if (source.tool === "get-article-details" && (source.input as { pmid?: string }).pmid === id) {
        const match = text.match(/\*\*Abstract:\*\*\s*([\s\S]*?)(?=\n\n\*\*|$)/);
        if (match?.[1] && !["null", "undefined"].includes(match[1].trim())) return match[1].trim();
      }
      if (source.tool === "search-medical-literature") {
        const section = text.split(/\n(?=\d+\. \*\*)/).find(section => section.includes("PMID: " + id + "\n"));
        const match = section?.match(/Abstract: ([^\n]+)/);
        if (match) return match[1];
      }
    }
    return null;
  }
  return { ...report,
    trials: report.trials.map(study => ({ ...study, abstract: abstract(study.id, study.sourceIds) })),
    research: report.research.map(study => ({ ...study, abstract: abstract(study.id, study.sourceIds) })),
  };
}

/** Validate provider citations against the actual MCP responses, never its own claims. */
export function validateReport(report: unknown, request: MedicalRequest, sources: SourceRecord[]) {
  const parsed = medicalReportSchema.parse(report);
  const records = new Map(sources.map(source => [source.id, source]));
  const ids = new Set<string>();
  if ((!request.clinicalTrials && parsed.trials.length) ||
      (!request.offLabelDrugsOrSupplements && parsed.research.length)) {
    throw new Error("The agent returned an unselected search.");
  }
  for (const name of [
    ...(request.clinicalTrials ? ["search-trials-with-eligibility"] : []),
    ...(request.offLabelDrugsOrSupplements ? ["search-medical-literature"] : []),
  ]) {
    if (!sources.some(source => source.tool === name)) throw new Error("The agent did not run the selected search.");
  }
  for (const study of [...parsed.trials, ...parsed.research]) {
    if (ids.has(study.id)) throw new Error("The agent returned a duplicate study.");
    ids.add(study.id);
    const cited = study.sourceIds.map(id => records.get(id));
    if (cited.some(source => !source || failedSource(source))) throw new Error("The agent cited an unknown or failed source.");
    const evidence = cited.map(source => evidenceText(source!.result)).join("\n");
    const mismatched = (["id", "title", "url"] as const).filter(field => !evidence.includes(study[field]));
    if (mismatched.length) {
      // A verified source URL can also tell the model which study ID to copy.
      const urlId = !mismatched.includes("url") ? new URL(study.url).pathname.split("/").filter(Boolean).at(-1) : undefined;
      const hint = mismatched.includes("id") && urlId && /^(NCT\d{8}|\d+)$/.test(urlId)
        ? ` The study id for this retrieved URL is '${urlId}'; citation UUIDs belong only in sourceIds.` : "";
      throw new Error(`Study ${study.id}: ${mismatched.join(", ")} does not match cited source(s) ${study.sourceIds.join(", ")}.${hint} Copy these fields exactly from the retrieved evidence; do not paraphrase titles or normalize URLs.`);
    }
    if (study.abstract !== null && !evidence.includes(study.abstract)) {
      throw new Error("A study abstract or summary does not match retrieved evidence.");
    }
    if (study.eligibility === "not-applicable") {
      throw new Error(`Study ${study.id} is marked not-applicable. Remove this study from the returned arrays and explain its exclusion in limitations. Published research that does not assess enrollment uses uncertain.`);
    }
    if (parsed.trials.includes(study) && !cited.some(source => source?.tool === "search-trials-with-eligibility")) {
      throw new Error("A trial has no retrieved eligibility record.");
    }
  }
  return parsed;
}

export function validateAnswers(questions: EligibilityQuestion[], input: unknown) {
  const parsed = resumeSchema.parse(input);
  const known = new Map(questions.map(question => [question.id, question]));
  const answers = new Map<string, string | number | boolean | null>();
  for (const item of parsed.answers) {
    const question = known.get(item.id);
    if (!question || answers.has(item.id)) throw new Error("Answers must reference each prepared question at most once.");
    const expected = question.type === "yes-no" ? "boolean" : question.type;
    if (item.answer !== null && typeof item.answer !== expected) throw new Error("An answer has the wrong type.");
    answers.set(item.id, item.answer);
  }
  return questions.map(question => ({
    question: question.question,
    answer: answers.get(question.id) ?? null,
    criterion: question.criterion,
    sourceIds: question.sourceIds,
  }));
}

async function invoke(session: Session, sessionId: string, answers?: JSONValue, signal?: AbortSignal): Promise<MedicalResearchResult> {
  if (!process.env.CEREBRAS_API_KEY) throw new Error("CEREBRAS_API_KEY is not configured.");
  const trialLimit = limit("MEDICAL_TRIAL_LIMIT", 10, 25);
  const researchLimit = limit("MEDICAL_RESEARCH_LIMIT", 5, 20);
  const turns = limit("MEDICAL_MAX_TURNS", 20, 50);
  const timeout = limit("MEDICAL_TIMEOUT_SECONDS", 180, 600);
  const connection = await connectMedicalMcp();
  const sources = [...session.sources];
  const tools = connection.tools
    .filter(remote => remote.name === "search-trials-with-eligibility"
      ? session.request.clinicalTrials : session.request.offLabelDrugsOrSupplements)
    .map(remote => tool({
      name: remote.name,
      description: remote.description,
      inputSchema: remote.toolSpec.inputSchema,
      callback: async (input, context): Promise<JSONValue> => {
        let args = input as Record<string, JSONValue>;
        if (remote.name === "search-trials-with-eligibility") {
          // Location and limits are application-owned, not model-controlled.
          args = { condition: session.request.condition, zipCode: session.request.zipCode,
            travelDistanceMiles: session.request.travelDistanceMiles, limit: trialLimit };
        } else if (remote.name === "search-medical-literature") {
          args = { ...args, max_results: researchLimit, rerank: false };
        }
        const previous = sources.find(source => source.tool === remote.name &&
          !failedSource(source) && isDeepStrictEqual(source.input, args));
        if (previous) {
          const stillInHistory = context?.agent.messages.some(message => message.content.some(block =>
            block.type === "toolResultBlock" && block.content.some(content => content.type === "jsonBlock" &&
              content.json !== null && typeof content.json === "object" && !Array.isArray(content.json) &&
              content.json.sourceId === previous.id && "result" in content.json)));
          if (!stillInHistory) return { sourceId: previous.id, result: medicalModelContext(remote.name, previous.result) };
          return { sourceId: previous.id, alreadyRetrieved: true,
            message: "Use this source's evidence already in the conversation; no new records were retrieved." };
        }
        let result: JSONValue;
        try {
          result = await connection.client.callTool(remote, args, {
            signal: context?.cancelSignal, timeoutMs: 30000,
          });
        } catch (error) {
          result = { isError: true, content: [{ type: "text",
            text: error instanceof Error ? error.message : "Source request failed." }] };
        }
        const id = randomUUID();
        sources.push({ id, tool: remote.name, input: args, result });
        const contextResult = medicalModelContext(remote.name, result);
        console.info(`[medical-mcp] ${remote.name}: raw=${JSON.stringify(result).length} chars, model=${JSON.stringify(contextResult).length} chars`);
        return { sourceId: id, result: contextResult };
      },
    }));
  const askQuestions = tool({
    name: "ask_eligibility_questions",
    description: "Pause and ask the user simple eligibility questions. Reference eligibility entry IDs from retrieved trials; do not copy criterion text. The server resolves the original criteria and returns user answers on resume; unanswered facts are null.",
    inputSchema: questionBatchSchema,
    callback: (input, context) => {
      if (!context || !session.request.clinicalTrials) throw new Error("Eligibility questions require a clinical trial search.");
      const questions = questionSchema.array().min(1).max(12).parse(input.questions.map((question, index) => {
        const references = question.criterionIds.map(criterionId => {
          for (const source of sources) {
            if (source.tool !== "search-trials-with-eligibility" || failedSource(source)) continue;
            const criterion = resolveEligibilityCriterion(source.result, criterionId);
            if (criterion) return { sourceId: source.id, criterion };
          }
          throw new Error(`Question ${index + 1}: unknown criterionId '${criterionId}'. Copy the complete id of an eligibility entry, including its NCT prefix (for example NCT12345678:c3).`);
        });
        return { id: `${context.toolUse.toolUseId}-${index}`, question: question.question, type: question.type,
          criterion: [...new Set(references.map(reference => reference.criterion))].join("\n"),
          sourceIds: [...new Set(references.map(reference => reference.sourceId))] };
      }));
      return context.interrupt({ name: "eligibility_questions", reason: { questions } });
    },
  });
  const finalSchema = medicalAgentReportSchema.superRefine((report, context) => {
    try {
      validateReport(hydrateReport(report, sources), session.request, sources);
      if (report.trials.length > 0 && answers === undefined) {
        throw new Error("Call ask_eligibility_questions before finalizing trial matches; you have not received eligibility answers.");
      }
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid source citations." });
    }
  });
  const agent = new Agent({
    model: new OpenAIModel({
      api: "chat", modelId: MODEL_ID, apiKey: process.env.CEREBRAS_API_KEY,
      clientConfig: { baseURL: "https://api.cerebras.ai/v1", maxRetries: 0 },
      temperature: 0.2, maxTokens: 8192,
      params: { reasoning_effort: "low", parallel_tool_calls: true },
      cacheConfig: { cacheKey: false },
    }),
    systemPrompt: MEDICAL_SYSTEM_PROMPT,
    tools: [...tools, askQuestions],
    structuredOutputSchema: finalSchema,
    toolExecutor: "concurrent",
    printer: false,
  });
  agent.addHook(BeforeModelCallEvent, event => {
    if (event.projectedInputTokens !== undefined) {
      console.info(`[medical-research] Estimated input: ${event.projectedInputTokens} tokens`);
    }
  });
  try {
    if (session.snapshot) agent.loadSnapshot(session.snapshot);
    console.info(`[medical-research] Using Cerebras: ${MODEL_ID}`);
    const result = await agent.invoke(answers !== undefined
      ? [new InterruptResponseContent({ interruptId: session.interruptId!, response: answers })]
      : JSON.stringify({ request: session.request, limits: { trials: trialLimit, research: researchLimit } }), {
        cancelSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout * 1000)]) : AbortSignal.timeout(timeout * 1000),
        limits: { turns },
      });
    if (result.stopReason === "interrupt") {
      const interrupt = result.interrupts?.[0];
      if (!interrupt || interrupt.name !== "eligibility_questions" || result.interrupts?.length !== 1) {
        throw new Error("Unexpected research interruption.");
      }
      const reason = interrupt.reason as { questions?: unknown };
      const questions = questionSchema.array().min(1).max(12).parse(reason?.questions);
      session.snapshot = agent.takeSnapshot({ preset: "session" });
      session.sources = sources;
      session.questions = questions;
      session.interruptId = interrupt.id;
      session.expiresAt = Date.now() + SESSION_TTL;
      sessions.set(sessionId, session);
      return { status: "questions", sessionId, questions, sources };
    }
    if (result.stopReason === "cancelled") throw new Error("Research timed out or was cancelled. Please retry.");
    if (result.stopReason.startsWith("limit")) throw new Error("Research reached its turn limit. Please retry with a more specific condition.");
    const report = validateReport(hydrateReport(result.structuredOutput, sources), session.request, sources);
    sessions.delete(sessionId);
    return { status: "complete", report, sources };
  } finally {
    // Cleanup failures must not replace the model error or a completed result.
    for (const close of [() => agent.shutdown(), () => connection.client.disconnect()]) {
      try { await close(); }
      catch (error) {
        console.warn("[medical-research] Cleanup failed:", error instanceof Error ? error.message : String(error));
      }
    }
  }
}

export async function startMedicalResearch(input: unknown, signal?: AbortSignal) {
  const request = medicalRequestSchema.parse(input);
  signal?.throwIfAborted();
  pruneSessions();
  if (sessions.size >= 50) throw new Error("Too many pending research sessions. Please retry later.");
  const session: Session = { request, sources: [], questions: [], expiresAt: Date.now() + SESSION_TTL, busy: true };
  try { return await invoke(session, randomUUID(), undefined, signal); }
  finally { session.busy = false; }
}

export async function resumeMedicalResearch(input: unknown, signal?: AbortSignal) {
  const parsed = resumeSchema.parse(input);
  signal?.throwIfAborted();
  pruneSessions();
  const session = sessions.get(parsed.sessionId);
  if (!session) throw new Error("This research session expired. Please start a new search.");
  if (session.busy) throw new Error("This research session is already processing answers.");
  const answers = validateAnswers(session.questions, parsed);
  session.busy = true;
  try { return await invoke(session, parsed.sessionId, answers, signal); }
  finally { session.busy = false; }
}
