import axios from "axios";
import { callLLM } from "@/lib/llm";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const MOCK_RESPONSE = {
  data: {
    choices: [{ message: { content: '{"firstName":"Jane"}' } }],
  },
};

beforeEach(() => {
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_API_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_LOCAL_URL;
  delete process.env.LLM_LOCAL_MODEL;
  mockedAxios.post.mockResolvedValue(MOCK_RESPONSE);
});

describe("callLLM — local mode (default)", () => {
  it("calls Ollama endpoint when LLM_PROVIDER is not set", async () => {
    const result = await callLLM("extract this", "you are a parser");

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("localhost:11434");
    expect(url).toContain("/v1/chat/completions");
    expect(result).toBe('{"firstName":"Jane"}');
  });

  it("uses LLM_LOCAL_URL and LLM_LOCAL_MODEL when provided", async () => {
    process.env.LLM_LOCAL_URL = "http://my-ollama:11434";
    process.env.LLM_LOCAL_MODEL = "mistral";

    await callLLM("prompt", "system");

    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("my-ollama:11434");
    expect((body as { model: string }).model).toBe("mistral");
  });

  it("sends system + user messages correctly", async () => {
    await callLLM("user prompt", "system prompt");

    const [, body] = mockedAxios.post.mock.calls[0];
    const messages = (body as { messages: Array<{ role: string; content: string }> }).messages;
    expect(messages[0]).toEqual({ role: "system", content: "system prompt" });
    expect(messages[1]).toEqual({ role: "user", content: "user prompt" });
  });
});

describe("callLLM — cloud mode", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "cloud";
    process.env.LLM_API_URL = "https://api.openai.com/v1";
    process.env.LLM_MODEL = "gpt-4o-mini";
    process.env.LLM_API_KEY = "sk-test-key";
  });

  it("calls the cloud endpoint with Authorization header", async () => {
    await callLLM("prompt", "system");

    const [url, , config] = mockedAxios.post.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((config as { headers: Record<string, string> }).headers["Authorization"]).toBe(
      "Bearer sk-test-key"
    );
  });

  it("uses LLM_MODEL in the request body", async () => {
    await callLLM("prompt", "system");

    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as { model: string }).model).toBe("gpt-4o-mini");
  });

  it("supports Mistral Cloud configuration", async () => {
    process.env.LLM_API_URL = "https://api.mistral.ai/v1";
    process.env.LLM_MODEL = "mistral-small-latest";

    await callLLM("prompt", "system");

    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect((body as { model: string }).model).toBe("mistral-small-latest");
  });

  it("throws when LLM_API_URL is missing", async () => {
    delete process.env.LLM_API_URL;
    await expect(callLLM("p", "s")).rejects.toThrow("LLM_API_URL");
  });

  it("throws when LLM_MODEL is missing", async () => {
    delete process.env.LLM_MODEL;
    await expect(callLLM("p", "s")).rejects.toThrow("LLM_MODEL");
  });

  it("throws when LLM_API_KEY is missing", async () => {
    delete process.env.LLM_API_KEY;
    await expect(callLLM("p", "s")).rejects.toThrow("LLM_API_KEY");
  });
});

describe("callLLM — error handling", () => {
  it("throws when LLM returns empty choices", async () => {
    mockedAxios.post.mockResolvedValue({ data: { choices: [] } });
    await expect(callLLM("p", "s")).rejects.toThrow("Empty response");
  });

  it("propagates network errors", async () => {
    mockedAxios.post.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(callLLM("p", "s")).rejects.toThrow("ECONNREFUSED");
  });
});
