import { downloadCandidateCv } from "@/controllers/jobController";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    jobOpening: {
      findUnique: jest.fn(),
    },
    candidate: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("@/lib/storage", () => ({
  downloadFile: jest.fn(),
}));

describe("downloadCandidateCv", () => {
  it("streams the stored CV file for a candidate in the authenticated organisation", async () => {
    const req = {
      params: { jobId: "job-1", candidateId: "candidate-1" },
      user: { organisationId: "org-1" },
    } as any;

    const res = {
      set: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as any;
    const next = jest.fn();

    (prisma.jobOpening.findUnique as jest.Mock).mockResolvedValue({
      id: "job-1",
      organisationId: "org-1",
    });
    (prisma.candidate.findFirst as jest.Mock).mockResolvedValue({
      id: "candidate-1",
      jobOpeningId: "job-1",
      rawFileUrl: "https://storage.example.com/cv-files/job-1/file.pdf",
    });
    (downloadFile as jest.Mock).mockResolvedValue(Buffer.from("%PDF-1.4"));

    await downloadCandidateCv(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.jobOpening.findUnique).toHaveBeenCalledWith({
      where: { id: "job-1" },
    });
    expect(prisma.candidate.findFirst).toHaveBeenCalledWith({
      where: {
        id: "candidate-1",
        jobOpeningId: "job-1",
      },
    });
    expect(downloadFile).toHaveBeenCalledWith(
      "https://storage.example.com/cv-files/job-1/file.pdf"
    );
    expect(res.set).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="file.pdf"'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(Buffer.from("%PDF-1.4"));
  });
});
