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
jest.mock("pdf-parse", () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({ text: "mock pdf text" }),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock("mammoth", () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: "mock docx text" }),
}));

import { downloadFile } from "@/lib/storage";
import { callLLM } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import mammoth from "mammoth";
import { startCvParsingWorker } from "@/workers/cvParser.worker";

const mockedDownload = downloadFile as jest.MockedFunction<typeof downloadFile>;
const mockedCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;
const mockedUpdate = prisma.candidate.update as jest.MockedFunction<
  typeof prisma.candidate.update
>;
const mockedMammoth = mammoth.extractRawText as jest.MockedFunction<
  typeof mammoth.extractRawText
>;

const VALID_PARSED_JSON = JSON.stringify({
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "+1234567890",
  summary: "Senior developer",
  workExperience: [
    {
      company: "Acme",
      title: "Dev",
      startDate: "2020-01",
      endDate: "2023-01",
      description: "Worked on things",
    },
  ],
  education: [],
  skills: ["TypeScript", "Node.js"],
  languages: [{ language: "English", level: "Native" }],
});

describe("CV parsing worker — processor function", () => {
  let processorFn: (job: {
    data: { candidateId: string; fileUrl: string };
    attemptsMade: number;
    opts: { attempts?: number };
  }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDownload.mockResolvedValue(Buffer.from("fake file"));
    mockedCallLLM.mockResolvedValue(VALID_PARSED_JSON);
    mockedUpdate.mockResolvedValue({} as never);

    // Capture the processor function passed to Worker constructor
    const { Worker } = jest.requireMock("bullmq") as {
      Worker: jest.Mock;
    };
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

  it("sets status to SCORED and populates parsedJson on success", async () => {
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

  it("uses mammoth for .docx files", async () => {
    await processorFn({
      data: { candidateId: "cand-2", fileUrl: "http://storage/file.docx" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(mockedMammoth).toHaveBeenCalled();
  });

  it("sets status to FAILED on the last retry attempt", async () => {
    mockedCallLLM.mockRejectedValue(new Error("LLM timeout"));

    await expect(
      processorFn({
        data: { candidateId: "cand-3", fileUrl: "http://storage/file.pdf" },
        attemptsMade: 2, // 3rd attempt (0-indexed), which is attempts - 1
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
    mockedCallLLM.mockRejectedValue(new Error("transient error"));

    await expect(
      processorFn({
        data: { candidateId: "cand-4", fileUrl: "http://storage/file.pdf" },
        attemptsMade: 0, // first attempt, not last
        opts: { attempts: 3 },
      })
    ).rejects.toThrow("transient error");

    // update should NOT have been called with FAILED
    const failedCall = mockedUpdate.mock.calls.find(
      ([arg]) =>
        (arg as { data: { status: string } }).data.status === CandidateStatus.FAILED
    );
    expect(failedCall).toBeUndefined();
  });

  it("handles LLM response wrapped in markdown code blocks", async () => {
    mockedCallLLM.mockResolvedValue(
      "```json\n" + VALID_PARSED_JSON + "\n```"
    );

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

  it("throws and marks FAILED when LLM returns invalid JSON on last attempt", async () => {
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
