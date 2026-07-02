// ── mock heavy dependencies before importing the worker ──────────────────────
jest.mock("@/lib/llm", () => ({
  callLLM: jest.fn(),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    candidate: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((_q: string, _fn: unknown, _opts: unknown) => ({
    on: jest.fn(),
  })),
  Queue: jest.fn().mockImplementation((name: string) => ({ name, add: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation((name: string) => ({ name })),
}));

import { callLLM } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { startCvScoringWorker } from "@/workers/cvScorer.worker";

const mockedCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;
const mockedFindUnique = prisma.candidate.findUnique as jest.MockedFunction<
  typeof prisma.candidate.findUnique
>;
const mockedUpdate = prisma.candidate.update as jest.MockedFunction<
  typeof prisma.candidate.update
>;

const VALID_SCORING_JSON = JSON.stringify({
  score: 82,
  matchedCriteria: ["5+ years React experience", "TypeScript proficiency"],
  missingCriteria: ["AWS certification"],
  strengths: ["Strong open-source contributions"],
  verdict: "GOOD_FIT",
});

const CANDIDATE_RECORD = {
  parsedJson: { skills: ["React", "TypeScript"] },
  jobOpening: { profileDescription: "Senior frontend engineer with React and AWS experience" },
};

describe("CV scoring worker — processor function", () => {
  let processorFn: (job: {
    data: { candidateId: string };
    attemptsMade: number;
    opts: { attempts?: number };
  }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindUnique.mockResolvedValue(CANDIDATE_RECORD as never);
    mockedCallLLM.mockResolvedValue(VALID_SCORING_JSON);
    mockedUpdate.mockResolvedValue({} as never);

    const { Worker } = jest.requireMock("bullmq") as { Worker: jest.Mock };
    Worker.mockImplementation(
      (_q: string, fn: typeof processorFn, _opts: unknown) => {
        processorFn = fn;
        return { on: jest.fn() };
      }
    );

    startCvScoringWorker();
  });

  it("fetches the candidate's parsedJson and job profile description", async () => {
    await processorFn({
      data: { candidateId: "cand-1" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cand-1" } })
    );
  });

  it("calls callLLM with the profile description and parsed CV data", async () => {
    await processorFn({
      data: { candidateId: "cand-1" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const [prompt] = mockedCallLLM.mock.calls[0];
    expect(prompt).toContain("Senior frontend engineer with React and AWS experience");
    expect(prompt).toContain("React");
  });

  it("updates score and scoreExplanation on success, without touching status", async () => {
    await processorFn({
      data: { candidateId: "cand-1" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "cand-1" },
      data: {
        score: 82,
        scoreExplanation: expect.objectContaining({
          score: 82,
          verdict: "GOOD_FIT",
          matchedCriteria: expect.any(Array),
          missingCriteria: expect.any(Array),
          strengths: expect.any(Array),
        }),
      },
    });

    const call = mockedUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty("status");
  });

  it("does not update the candidate when the LLM call fails (score stays null)", async () => {
    mockedCallLLM.mockRejectedValue(new Error("LLM timeout"));

    await expect(
      processorFn({
        data: { candidateId: "cand-2" },
        attemptsMade: 2,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow("LLM timeout");

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the LLM returns unparseable JSON", async () => {
    mockedCallLLM.mockResolvedValue("not json at all {{");

    await expect(
      processorFn({
        data: { candidateId: "cand-3" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow();

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the LLM returns a score outside 0-100", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({
        score: 150,
        matchedCriteria: [],
        missingCriteria: [],
        strengths: [],
        verdict: "GOOD_FIT",
      })
    );

    await expect(
      processorFn({
        data: { candidateId: "cand-4" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow(/Invalid score/);

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the LLM returns an invalid verdict", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({
        score: 50,
        matchedCriteria: [],
        missingCriteria: [],
        strengths: [],
        verdict: "AMAZING_FIT",
      })
    );

    await expect(
      processorFn({
        data: { candidateId: "cand-5" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow(/Invalid verdict/);
  });

  it("retries on non-final attempts without giving up", async () => {
    mockedCallLLM.mockRejectedValue(new Error("transient error"));

    await expect(
      processorFn({
        data: { candidateId: "cand-6" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow("transient error");

    // Job should still throw to let BullMQ retry — no candidate update either way
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});

describe("startCvScoringWorker", () => {
  it("creates a Worker on the cv-scoring queue", () => {
    const { Worker } = jest.requireMock("bullmq") as { Worker: jest.Mock };
    Worker.mockClear();
    Worker.mockImplementation(() => ({ on: jest.fn() }));

    startCvScoringWorker();

    expect(Worker).toHaveBeenCalledWith(
      "cv-scoring",
      expect.any(Function),
      expect.objectContaining({ connection: expect.any(Object) })
    );
  });
});
