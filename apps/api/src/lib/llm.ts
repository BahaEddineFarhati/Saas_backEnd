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

async function callCloud(prompt: string, systemPrompt: string): Promise<string> {
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

  const body: OpenAIRequest = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    temperature: 0,
  };

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

async function callLocal(prompt: string, systemPrompt: string): Promise<string> {
  const baseUrl = process.env.LLM_LOCAL_URL ?? "http://localhost:11434";
  const model = process.env.LLM_LOCAL_MODEL ?? "llama3";

  const body: OpenAIRequest = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    temperature: 0,
  };

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

/**
 * Unified LLM call.  Routing is controlled exclusively by LLM_PROVIDER:
 *   LLM_PROVIDER=cloud  → external API (OpenAI / Mistral / Anthropic compatible)
 *   LLM_PROVIDER=local  → local Ollama instance (OpenAI-compatible endpoint)
 */
export async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  const provider = process.env.LLM_PROVIDER ?? "local";

  if (provider === "cloud") {
    return callCloud(prompt, systemPrompt);
  }

  return callLocal(prompt, systemPrompt);
}
