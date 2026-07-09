import axios from "axios";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
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

// ── Internal helpers ────────────────────────────────────────────────────────

async function callCloudInternal(messages: OpenAIMessage[], temperature: number): Promise<string> {
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
  return content;
}

async function callLocalInternal(messages: OpenAIMessage[], temperature: number): Promise<string> {
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
  return content;
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
 * When `options.messages` is provided, the `prompt` argument is ignored and
 * the conversation history is used instead.
 */
export async function callLLM(
  prompt: string,
  systemPrompt: string,
  options?: CallLLMOptions
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

  if (provider === "cloud") {
    return callCloudInternal(messages, temperature);
  }

  return callLocalInternal(messages, temperature);
}
