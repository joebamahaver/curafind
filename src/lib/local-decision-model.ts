import { z } from "zod";

// Ollama System One wire contract: https://docs.ollama.com/api/systemone
const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("score"),
    instructions: z.string().trim().min(1),
    criteria: z.array(z.string().min(1)).min(2).max(10),
  }),
  z.object({
    type: z.literal("noul"),
    instructions: z.string().trim().min(1),
    criteria: z.object({ true: z.string().min(1), false: z.string().min(1) }).optional(),
  }),
  z.object({
    type: z.literal("choice"),
    instructions: z.string().trim().min(1),
    criteria: z.record(z.string().min(1), z.string().nullable()).refine(
      criteria => Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 26,
      "Choice questions require 2 to 26 options.",
    ),
  }),
]);

export type DecisionQuestion = z.infer<typeof questionSchema>;
type DecisionValues<Q extends Record<string, DecisionQuestion>> = {
  [K in keyof Q]: Q[K]["type"] extends "choice" ? string : number;
};

export interface LocalDecisionConfig {
  baseUrl?: string;
  modelId?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

/** Stateless local model adapter: typed decisions, with no chat history or rotation. */
export class LocalDecisionModel {
  private readonly baseUrl: URL;
  private readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(config: LocalDecisionConfig = {}) {
    this.baseUrl = new URL(config.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
    if (!["http:", "https:"].includes(this.baseUrl.protocol) || this.baseUrl.search || this.baseUrl.hash) {
      throw new Error("OLLAMA_BASE_URL must be an HTTP(S) base URL without a query or fragment.");
    }
    // A trailing slash preserves reverse-proxy prefixes when resolving the API path.
    this.baseUrl.pathname = this.baseUrl.pathname.replace(/\/$/, "") + "/";
    this.modelId = (config.modelId ?? process.env.DECISIONS_MODEL ?? "tev1:4b").trim();
    if (!this.modelId) throw new Error("DECISIONS_MODEL must be a non-empty Ollama model name.");
    this.timeoutMs = config.timeoutMs ?? Number(process.env.DECISIONS_TIMEOUT_MS ?? "120000");
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2147483647) {
      throw new Error("DECISIONS_TIMEOUT_MS must be a positive whole number no greater than 2147483647.");
    }
    this.fetcher = config.fetcher ?? fetch;
  }

  getConfig() {
    return { baseUrl: this.baseUrl.href, modelId: this.modelId, timeoutMs: this.timeoutMs };
  }

  async invoke<Q extends Record<string, DecisionQuestion>>(
    state: string | Record<string, unknown> | unknown[],
    questions: Q,
    options: { signal?: AbortSignal } = {},
  ): Promise<DecisionValues<Q>> {
    if (typeof state === "string" && !state.trim()) throw new Error("Decision state must not be empty.");
    const parsed = z.record(z.string().min(1), questionSchema).parse(questions);
    if (Object.keys(parsed).length < 1 || Object.keys(parsed).length > 64) {
      throw new Error("Decisions requests require 1 to 64 named questions.");
    }
    const body = JSON.stringify({ model: this.modelId, state, questions: parsed });
    if (Buffer.byteLength(body, "utf8") > 64 * 1024) {
      throw new Error("Decisions request exceeds Ollama's 64 KiB text limit.");
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    signal.throwIfAborted();
    const response = await this.fetcher(new URL("v1/systemone", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama decisions request failed (HTTP ${response.status}). Check Ollama 0.35+ and the installed ${this.modelId} model.`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Ollama decisions API returned unreadable JSON.");
    }
    signal.throwIfAborted();
    const { answers } = z.object({ answers: z.record(z.string(), z.unknown()) }).parse(payload);
    const values: Record<string, string | number> = {};
    for (const [name, question] of Object.entries(parsed)) {
      const answer = answers[name];
      if (question.type === "score") {
        values[name] = z.object({ type: z.literal("score"), score: z.number().min(0).max(question.criteria.length - 1) }).parse(answer).score;
      } else if (question.type === "noul") {
        values[name] = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }).parse(answer).noul;
      } else {
        const { choice } = z.object({ type: z.literal("choice"), choice: z.string() }).parse(answer);
        if (!Object.hasOwn(question.criteria, choice)) throw new Error(`Decision ${name} returned an unknown choice.`);
        values[name] = choice;
      }
    }
    return values as DecisionValues<Q>;
  }
}

// Read server configuration at invocation time, so a bad local configuration
// does not prevent unrelated cloud question/ranking calls from loading.
export function createLocalDecisionModel(config: LocalDecisionConfig = {}) {
  return new LocalDecisionModel(config);
}
