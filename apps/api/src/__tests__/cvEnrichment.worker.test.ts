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

// ── Test fixtures ────────────────────────────────────────────────────────────

const VALID_SCORING_JSON = JSON.stringify({
  score: 82,
  matchedCriteria: ["5+ years React experience", "TypeScript proficiency"],
  missingCriteria: ["AWS certification", "Docker experience"],
  strengths: ["Strong open-source contributions", "Leadership in agile teams"],
  verdict: "GOOD_FIT",
});

const VALID_SUMMARY = "This candidate brings over 5 years of frontend development experience with React and TypeScript, directly aligning with the core requirements for this senior frontend engineer role. Their strong open-source contributions demonstrate initiative and community engagement. However, they lack AWS certification and Docker experience, which are listed requirements for the position. Overall, their technical foundation and leadership qualities make them a solid contender with some areas that would benefit from on-the-job training.";

const VALID_INTERVIEW_QUESTIONS = JSON.stringify([
  {
    question: "Can you describe any experience you have with AWS services, even if informal or through personal projects?",
    rationale: "Probes the candidate's AWS certification gap to uncover any unlisted cloud experience.",
  },
  {
    question: "Have you worked with Docker or containerization in any capacity?",
    rationale: "Explores the Docker experience gap identified in the scoring analysis.",
  },
  {
    question: "How would you approach learning a new cloud platform if required for this role?",
    rationale: "Assesses the candidate's ability to compensate for missing cloud infrastructure skills.",
  },
  {
    question: "Tell me about your most significant open-source contribution and what impact it had.",
    rationale: "Validates the strength of open-source contributions by probing for depth and impact.",
  },
  {
    question: "Describe a situation where you led an agile team through a challenging sprint.",
    rationale: "Verifies the claimed leadership in agile teams with a concrete example.",
  },
  {
    question: "Tell me about a time you had to resolve a conflict within your development team.",
    rationale: "Behavioural question to assess conflict resolution skills relevant to a senior role.",
  },
  {
    question: "Describe a situation where you had to make a difficult technical trade-off under time pressure.",
    rationale: "Behavioural question to evaluate decision-making under constraints typical of this role.",
  },
]);

const CANDIDATE_RECORD = {
  parsedJson: { skills: ["React", "TypeScript"], firstName: "John", lastName: "Doe" },
  jobOpening: { profileDescription: "Senior frontend engineer with React and AWS experience" },
};

// ── Test helpers ─────────────────────────────────────────────────────────────

function createJob(candidateId: string) {
  return {
    data: { candidateId },
    attemptsMade: 0,
    opts: { attempts: 3 },
  };
}

describe("CV enrichment — summary + interview questions", () => {
  let processorFn: (job: {
    data: { candidateId: string };
    attemptsMade: number;
    opts: { attempts?: number };
  }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindUnique.mockResolvedValue(CANDIDATE_RECORD as never);
    // Default: scoring succeeds, then summary succeeds, then interview questions succeed
    mockedCallLLM
      .mockResolvedValueOnce(VALID_SCORING_JSON)        // scoring call
      .mockResolvedValueOnce(VALID_SUMMARY)             // summary call
      .mockResolvedValueOnce(VALID_INTERVIEW_QUESTIONS); // interview questions call
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

  it("calls callLLM exactly 3 times: scoring + summary + interview questions", async () => {
    await processorFn(createJob("cand-1"));

    expect(mockedCallLLM).toHaveBeenCalledTimes(3);
  });

  it("writes score, then enrichment data in separate updates", async () => {
    await processorFn(createJob("cand-1"));

    // First update: score + scoreExplanation
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cand-1" },
        data: expect.objectContaining({
          score: 82,
          scoreExplanation: expect.objectContaining({ verdict: "GOOD_FIT" }),
        }),
      })
    );

    // Second update: enrichment data (summary + interviewQuestions)
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cand-1" },
        data: expect.objectContaining({
          summary: expect.any(String),
          interviewQuestions: expect.any(Array),
        }),
      })
    );
  });

  it("populates summary with a non-empty role-specific string", async () => {
    await processorFn(createJob("cand-1"));

    const enrichmentCall = mockedUpdate.mock.calls[1];
    const data = (enrichmentCall[0] as { data: Record<string, unknown> }).data;
    expect(typeof data.summary).toBe("string");
    expect((data.summary as string).length).toBeGreaterThan(50);
  });

  it("populates interviewQuestions with exactly 7 objects having question and rationale", async () => {
    await processorFn(createJob("cand-1"));

    const enrichmentCall = mockedUpdate.mock.calls[1];
    const data = (enrichmentCall[0] as { data: Record<string, unknown> }).data;
    const questions = data.interviewQuestions as Array<{ question: string; rationale: string }>;
    expect(questions).toHaveLength(7);
    for (const q of questions) {
      expect(typeof q.question).toBe("string");
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(typeof q.rationale).toBe("string");
      expect(q.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("summary LLM call receives parsedJson and profileDescription", async () => {
    await processorFn(createJob("cand-1"));

    // The second callLLM call is for the summary
    const [summaryPrompt] = mockedCallLLM.mock.calls[1];
    expect(summaryPrompt).toContain("Senior frontend engineer with React and AWS experience");
    expect(summaryPrompt).toContain("React");
    expect(summaryPrompt).toContain("TypeScript");
  });

  it("interview questions LLM call receives missingCriteria and strengths", async () => {
    await processorFn(createJob("cand-1"));

    // The third callLLM call is for interview questions
    const [interviewPrompt] = mockedCallLLM.mock.calls[2];
    expect(interviewPrompt).toContain("AWS certification");
    expect(interviewPrompt).toContain("Docker experience");
    expect(interviewPrompt).toContain("Strong open-source contributions");
    expect(interviewPrompt).toContain("Leadership in agile teams");
  });

  it("failed summary call leaves summary null but interviewQuestions populated", async () => {
    mockedCallLLM
      .mockReset()
      .mockResolvedValueOnce(VALID_SCORING_JSON)          // scoring
      .mockRejectedValueOnce(new Error("Summary timeout")) // summary fails
      .mockResolvedValueOnce(VALID_INTERVIEW_QUESTIONS);    // questions succeed

    await processorFn(createJob("cand-2"));

    // Score update should still happen
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 82 }),
      })
    );

    // Enrichment update should only have interviewQuestions, not summary
    const enrichmentCall = mockedUpdate.mock.calls[1];
    const data = (enrichmentCall[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("summary");
    expect(data.interviewQuestions).toHaveLength(7);
  });

  it("failed interview questions call leaves interviewQuestions null but summary populated", async () => {
    mockedCallLLM
      .mockReset()
      .mockResolvedValueOnce(VALID_SCORING_JSON)              // scoring
      .mockResolvedValueOnce(VALID_SUMMARY)                    // summary succeeds
      .mockRejectedValueOnce(new Error("Questions timeout"));  // questions fail

    await processorFn(createJob("cand-3"));

    const enrichmentCall = mockedUpdate.mock.calls[1];
    const data = (enrichmentCall[0] as { data: Record<string, unknown> }).data;
    expect(data.summary).toBe(VALID_SUMMARY);
    expect(data).not.toHaveProperty("interviewQuestions");
  });

  it("both enrichment calls failing leaves score unaffected and no enrichment update", async () => {
    mockedCallLLM
      .mockReset()
      .mockResolvedValueOnce(VALID_SCORING_JSON)              // scoring succeeds
      .mockRejectedValueOnce(new Error("Summary timeout"))    // summary fails
      .mockRejectedValueOnce(new Error("Questions timeout")); // questions fail

    await processorFn(createJob("cand-4"));

    // Only one update call: the scoring update
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 82 }),
      })
    );
  });

  it("scoring failure prevents enrichment from running", async () => {
    mockedCallLLM.mockReset().mockRejectedValueOnce(new Error("Scoring LLM failed"));

    await expect(processorFn(createJob("cand-5"))).rejects.toThrow("Scoring LLM failed");

    // callLLM was only called once (for scoring) — enrichment never started
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("rejects interview questions if LLM returns != 7 items", async () => {
    const only3Questions = JSON.stringify([
      { question: "Q1?", rationale: "R1" },
      { question: "Q2?", rationale: "R2" },
      { question: "Q3?", rationale: "R3" },
    ]);

    mockedCallLLM
      .mockReset()
      .mockResolvedValueOnce(VALID_SCORING_JSON)
      .mockResolvedValueOnce(VALID_SUMMARY)
      .mockResolvedValueOnce(only3Questions);

    await processorFn(createJob("cand-6"));

    // Summary should still be saved
    const enrichmentCall = mockedUpdate.mock.calls[1];
    const data = (enrichmentCall[0] as { data: Record<string, unknown> }).data;
    expect(data.summary).toBe(VALID_SUMMARY);
    expect(data).not.toHaveProperty("interviewQuestions");
  });
});
