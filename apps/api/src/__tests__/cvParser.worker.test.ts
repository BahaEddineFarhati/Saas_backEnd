import { CandidateStatus } from "@prisma/client";

// ── mock heavy dependencies before importing the worker ──────────────────────
jest.mock("@/lib/storage", () => ({
  downloadFile: jest.fn(),
}));
jest.mock("@/lib/llm", () => ({
  callLLM: jest.fn(),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: { candidate: { update: jest.fn() } },
}));
jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((_q: string, _fn: unknown, _opts: unknown) => ({
    on: jest.fn(),
  })),
  Queue: jest.fn().mockImplementation((name: string) => ({ name })),
  QueueEvents: jest.fn().mockImplementation((name: string) => ({ name })),
}));
jest.mock("@/lib/extractText", () => ({
  extractText: jest.fn().mockResolvedValue("mock extracted text from CV"),
  ParsingQualityError: class ParsingQualityError extends Error {
    constructor(message: string) { super(message); this.name = "ParsingQualityError"; }
  },
}));

import { downloadFile } from "@/lib/storage";
import { callLLM } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { extractText, ParsingQualityError } from "@/lib/extractText";
import { startCvParsingWorker } from "@/workers/cvParser.worker";

const mockedDownload = downloadFile as jest.MockedFunction<typeof downloadFile>;
const mockedCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;
const mockedUpdate = prisma.candidate.update as jest.MockedFunction<
  typeof prisma.candidate.update
>;
const mockedExtractText = extractText as jest.MockedFunction<typeof extractText>;

// Section-level JSON returned by each of the 4 LLM calls
const PERSONAL_JSON = JSON.stringify({
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "+1234567890",
  summary: "Senior developer",
});
const WORK_JSON = JSON.stringify({
  workExperience: [
    { company: "Acme", title: "Dev", startDate: "2020-01", endDate: "2023-01", description: "Built things" },
  ],
});
const EDUCATION_JSON = JSON.stringify({ education: [] });
const SKILLS_JSON = JSON.stringify({
  skills: ["TypeScript", "Node.js"],
  languages: [{ language: "English", level: "Native" }],
});

/** Reset callLLM to return the 4 section responses in order */
function mockFourCalls() {
  mockedCallLLM
    .mockResolvedValueOnce(PERSONAL_JSON)
    .mockResolvedValueOnce(WORK_JSON)
    .mockResolvedValueOnce(EDUCATION_JSON)
    .mockResolvedValueOnce(SKILLS_JSON);
}

describe("CV parsing worker — processor function", () => {
  let processorFn: (job: {
    data: { candidateId: string; fileUrl: string };
    attemptsMade: number;
    opts: { attempts?: number };
  }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDownload.mockResolvedValue(Buffer.from("fake file"));
    mockedExtractText.mockResolvedValue("mock extracted CV text");
    mockedUpdate.mockResolvedValue({} as never);
    mockFourCalls();

    const { Worker } = jest.requireMock("bullmq") as { Worker: jest.Mock };
    Worker.mockImplementation(
      (_q: string, fn: typeof processorFn, _opts: unknown) => {
        processorFn = fn;
        return { on: jest.fn() };
      }
    );
    startCvParsingWorker();
  });

  it("downloads the file from the provided URL", async () => {
    await processorFn({
      data: { candidateId: "cand-1", fileUrl: "http://storage/jobs/job1/file.pdf" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedDownload).toHaveBeenCalledWith("http://storage/jobs/job1/file.pdf");
  });

  it("makes exactly 4 LLM calls per job", async () => {
    await processorFn({
      data: { candidateId: "cand-1", fileUrl: "http://storage/file.pdf" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedCallLLM).toHaveBeenCalledTimes(4);
  });

  it("sets status to SCORED and populates parsedJson with merged sections", async () => {
    await processorFn({
      data: { candidateId: "cand-1", fileUrl: "http://storage/file.pdf" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cand-1" },
        data: expect.objectContaining({
          status: CandidateStatus.SCORED,
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com",
        }),
      })
    );
  });

  it("parsedJson contains fields from all 4 sections", async () => {
    await processorFn({
      data: { candidateId: "cand-1", fileUrl: "http://storage/file.pdf" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    const call = mockedUpdate.mock.calls[0][0] as { data: { parsedJson: Record<string, unknown> } };
    const pj = call.data.parsedJson;
    expect(pj).toMatchObject({
      firstName: "Jane",
      workExperience: expect.any(Array),
      education: expect.any(Array),
      skills: expect.arrayContaining(["TypeScript"]),
      languages: expect.any(Array),
    });
  });

  it("calls extractText with the downloaded buffer and file URL", async () => {
    const buf = Buffer.from("fake file");
    mockedDownload.mockResolvedValue(buf);

    await processorFn({
      data: { candidateId: "cand-2", fileUrl: "http://storage/file.docx" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedExtractText).toHaveBeenCalledWith(buf, "http://storage/file.docx");
  });

  it("sets status to FAILED on the last retry attempt", async () => {
    mockedCallLLM.mockReset();
    mockedCallLLM.mockRejectedValue(new Error("LLM timeout"));

    await expect(
      processorFn({
        data: { candidateId: "cand-3", fileUrl: "http://storage/file.pdf" },
        attemptsMade: 2,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow("LLM timeout");

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cand-3" },
        data: { status: CandidateStatus.FAILED },
      })
    );
  });

  it("does NOT set FAILED status on non-final retries", async () => {
    mockedCallLLM.mockReset();
    mockedCallLLM.mockRejectedValue(new Error("transient error"));

    await expect(
      processorFn({
        data: { candidateId: "cand-4", fileUrl: "http://storage/file.pdf" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow("transient error");

    const failedCall = mockedUpdate.mock.calls.find(
      ([arg]) =>
        (arg as { data: { status: string } }).data.status === CandidateStatus.FAILED
    );
    expect(failedCall).toBeUndefined();
  });

  it("handles LLM response wrapped in markdown code blocks", async () => {
    mockedCallLLM
      .mockResolvedValueOnce("```json\n" + PERSONAL_JSON + "\n```")
      .mockResolvedValueOnce("```json\n" + WORK_JSON + "\n```")
      .mockResolvedValueOnce("```json\n" + EDUCATION_JSON + "\n```")
      .mockResolvedValueOnce("```json\n" + SKILLS_JSON + "\n```");

    await processorFn({
      data: { candidateId: "cand-5", fileUrl: "http://storage/file.pdf" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: CandidateStatus.SCORED }),
      })
    );
  });

  it("marks FAILED immediately on ParsingQualityError without waiting for last attempt", async () => {
    mockedExtractText.mockRejectedValue(
      new ParsingQualityError("Extracted text is too short (10 chars).")
    );

    await expect(
      processorFn({
        data: { candidateId: "cand-7", fileUrl: "http://storage/file.pdf" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow("Extracted text is too short");

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cand-7" },
        data: { status: CandidateStatus.FAILED },
      })
    );
  });

  it("throws and marks FAILED when a section LLM call returns invalid JSON on last attempt", async () => {
    mockedCallLLM.mockReset();
    mockedCallLLM.mockResolvedValue("not json at all {{");

    await expect(
      processorFn({
        data: { candidateId: "cand-6", fileUrl: "http://storage/file.pdf" },
        attemptsMade: 2,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow();

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: CandidateStatus.FAILED },
      })
    );
  });
});

describe("startCvParsingWorker", () => {
  it("creates a Worker on the cv-parsing queue", () => {
    const { Worker } = jest.requireMock("bullmq") as { Worker: jest.Mock };
    Worker.mockClear();
    Worker.mockImplementation(() => ({ on: jest.fn() }));

    startCvParsingWorker();

    expect(Worker).toHaveBeenCalledWith(
      "cv-parsing",
      expect.any(Function),
      expect.objectContaining({ connection: expect.any(Object) })
    );
  });
});
