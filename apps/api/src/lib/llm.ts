import axios from "axios";
import { LLMFeature } from "@prisma/client";
import { prisma } from "@/lib/prisma";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: OpenAIUsage;
  // Ollama native fields (fallback when OpenAI-compat usage is missing)
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Internal result returned by cloud/local helpers — carries content + token usage. */
interface LLMInternalResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Options for multi-turn chat or custom temperature settings.
 * When `messages` is provided, `prompt` is ignored and the full conversation
 * history is sent to the LLM instead of a single user message.
 */
export interface CallLLMOptions {
  /** Full conversation history (user + assistant turns). When provided, the `prompt` argument is ignored. */
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  /** LLM sampling temperature. Defaults to 0 (deterministic). Use 0.3 for conversational chat. */
  temperature?: number;
}

/** Context needed to attribute LLM usage to a specific organisation and user. */
export interface LLMUsageContext {
  organisationId: string;
  userId: string;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function extractUsage(data: OpenAIResponse): LLMInternalResult["usage"] {
  // Cloud providers (OpenAI, Mistral, Anthropic) and Ollama's OpenAI-compat endpoint
  if (data.usage) {
    return {
      promptTokens: data.usage.prompt_tokens ?? 0,
      completionTokens: data.usage.completion_tokens ?? 0,
      totalTokens: data.usage.total_tokens ?? 0,
    };
  }

  // Ollama native response fields (fallback)
  const promptTokens = data.prompt_eval_count ?? 0;
  const completionTokens = data.eval_count ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

async function callCloudInternal(messages: OpenAIMessage[], temperature: number): Promise<LLMInternalResult> {
  const apiUrl = process.env.LLM_API_URL;
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!apiUrl || !model || !apiKey) {
    throw new Error(
      "Cloud LLM requires LLM_API_URL, LLM_MODEL, and LLM_API_KEY environment variables."
    );
  }

  // Supports OpenAI-compatible cloud providers, including Mistral Cloud.
  // For Mistral, use:
  //   LLM_API_URL=https://api.mistral.ai/v1
  //   LLM_MODEL=mistral-small-latest

  const body: OpenAIRequest = { model, messages, temperature };

  const response = await axios.post<OpenAIResponse>(
    `${apiUrl.replace(/\/$/, "")}/chat/completions`,
    body,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 360_000,
    }
  );

  const content = response.data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from cloud LLM.");

  return { content, usage: extractUsage(response.data) };
}

async function callLocalInternal(messages: OpenAIMessage[], temperature: number): Promise<LLMInternalResult> {
  const baseUrl = process.env.LLM_LOCAL_URL ?? "http://localhost:11434";
  const model = process.env.LLM_LOCAL_MODEL ?? "llama3";

  const body: OpenAIRequest = { model, messages, temperature };

  const response = await axios.post<OpenAIResponse>(
    `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
    body,
    {
      headers: { "Content-Type": "application/json" },
      timeout: 360_000,
    }
  );

  const content = response.data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from local LLM.");

  return { content, usage: extractUsage(response.data) };
}

// ── Token usage logging ─────────────────────────────────────────────────────

/**
 * Map LLMFeature enum to the corresponding feature-specific token column
 * on the LLMUsageSummary model.
 */
function featureToTokenColumn(feature: LLMFeature): string {
  switch (feature) {
    case LLMFeature.CV_PARSING:
      return "cvParsingTokens";
    case LLMFeature.CV_SCORING:
      return "cvScoringTokens";
    case LLMFeature.CV_ENRICHMENT:
      return "cvEnrichmentTokens";
    case LLMFeature.CHAT:
      return "chatTokens";
  }
}

/**
 * Silently log token usage to the database.
 * Creates a LLMUsageLog row and upserts the LLMUsageSummary row.
 * NEVER throws — errors are logged with console.error and swallowed.
 */
async function logTokenUsage(
  feature: LLMFeature,
  context: LLMUsageContext,
  usage: LLMInternalResult["usage"],
  provider: string,
  model: string
): Promise<void> {
  try {
    const now = new Date();
    const month = now.getMonth() + 1; // 1–12
    const year = now.getFullYear();

    const featureColumn = featureToTokenColumn(feature);

    // Create the raw log entry and upsert the summary atomically
    await prisma.$transaction([
      prisma.lLMUsageLog.create({
        data: {
          organisationId: context.organisationId,
          userId: context.userId,
          feature,
          provider,
          model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          month,
          year,
        },
      }),
      prisma.lLMUsageSummary.upsert({
        where: {
          organisationId_month_year: {
            organisationId: context.organisationId,
            month,
            year,
          },
        },
        create: {
          organisationId: context.organisationId,
          month,
          year,
          totalTokens: usage.totalTokens,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          [featureColumn]: usage.totalTokens,
          callCount: 1,
        },
        update: {
          totalTokens: { increment: usage.totalTokens },
          promptTokens: { increment: usage.promptTokens },
          completionTokens: { increment: usage.completionTokens },
          [featureColumn]: { increment: usage.totalTokens },
          callCount: { increment: 1 },
        },
      }),
    ]);
  } catch (err) {
    console.error(
      "⚠️ Failed to log LLM token usage (non-blocking):",
      err instanceof Error ? err.message : err
    );
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Unified LLM call.  Routing is controlled exclusively by LLM_PROVIDER:
 *   LLM_PROVIDER=cloud  → external API (OpenAI / Mistral / Anthropic compatible)
 *   LLM_PROVIDER=local  → local Ollama instance (OpenAI-compatible endpoint)
 *
 * Basic usage (single prompt — CV parsing, scoring):
 *   callLLM(prompt, systemPrompt)
 *
 * Multi-turn chat usage (conversation history):
 *   callLLM("", systemPrompt, {
 *     messages: [{ role: "user", content: "..." }, { role: "assistant", content: "..." }],
 *     temperature: 0.3,
 *   })
 *
 * Token tracking usage (pass feature + context to enable silent logging):
 *   callLLM(prompt, systemPrompt, undefined, LLMFeature.CV_PARSING, { organisationId, userId })
 *
 * When `options.messages` is provided, the `prompt` argument is ignored and
 * the conversation history is used instead.
 */
export async function callLLM(
  prompt: string,
  systemPrompt: string,
  options?: CallLLMOptions,
  feature?: LLMFeature,
  context?: LLMUsageContext
): Promise<string> {
  const provider = process.env.LLM_PROVIDER ?? "local";
  const temperature = options?.temperature ?? 0;

  // Build the messages array
  let messages: OpenAIMessage[];

  if (options?.messages && options.messages.length > 0) {
    // Multi-turn chat mode: system prompt + conversation history
    messages = [
      { role: "system", content: systemPrompt },
      ...options.messages,
    ];
  } else {
    // Single-prompt mode: system prompt + one user message (backward compatible)
    messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];
  }

  // Call the appropriate provider
  let result: LLMInternalResult;

  if (provider === "cloud") {
    result = await callCloudInternal(messages, temperature);
  } else {
    result = await callLocalInternal(messages, temperature);
  }

  // Log token usage silently if feature + context are provided
  if (feature && context) {
    const modelName =
      provider === "cloud"
        ? process.env.LLM_MODEL ?? "unknown"
        : process.env.LLM_LOCAL_MODEL ?? "llama3";

    // Fire-and-forget — never block the response
    logTokenUsage(feature, context, result.usage, provider, modelName).catch(
      () => {
        // Already handled inside logTokenUsage, but double-safety
      }
    );
  }

  return result.content;
}
