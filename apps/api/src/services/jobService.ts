import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { deleteFile, uploadFile } from "@/lib/storage";
import { cvParsingQueue } from "@/lib/queue";
import type { CvParsingJobData } from "@/workers/cvParser.worker";
import { CandidateStatus } from "@prisma/client";

export type ScoringStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export interface ScoringStatusSummary {
  totalCandidates: number;
  parsedCount: number;
  scoredCount: number;
  failedCount: number;
  scoringStatus: ScoringStatus;
}

export interface CandidateScoreSortItem {
  id: string;
  score: number | null;
}

const slugifyTitle = (title: string): string => {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "job";
};

const generateInboundEmailCode = async (): Promise<string> => {
  for (let i = 0; i < 10; i += 1) {
    const code = randomBytes(3).toString("hex").slice(0, 6).toUpperCase();
    const existing = await prisma.jobOpening.findFirst({
      where: { inboundEmailCode: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  throw new AppError("Unable to generate a unique inbound email code", 500, "INBOUND_EMAIL_CODE_FAILED");
};

export const createPendingCandidateFromFile = async (
  jobId: string,
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string
) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const fileExtension = originalName.split(".").pop() ?? "bin";
  const uniqueFileName = `jobs/${jobId}/${timestamp}-${random}.${fileExtension}`;

  const rawFileUrl = await uploadFile(fileBuffer, uniqueFileName, mimeType);

  const candidate = await prisma.candidate.create({
    data: {
      firstName: "",
      lastName: "",
      email: "",
      rawFileUrl,
      status: CandidateStatus.PENDING,
      jobOpeningId: jobId,
    },
  });

  const jobData: CvParsingJobData = {
    candidateId: candidate.id,
    fileUrl: rawFileUrl,
  };

  await cvParsingQueue.add("parse-cv", jobData, {
    jobId: `parse-cv-${candidate.id}`,
  });

  return candidate;
};

export const calculateScoringStatusSummary = ({
  totalCandidates,
  parsedCount,
  scoredCount,
  failedCount,
}: {
  totalCandidates: number;
  parsedCount: number;
  scoredCount: number;
  failedCount: number;
}): ScoringStatusSummary => {
  if (totalCandidates === 0 || parsedCount === 0) {
    return {
      totalCandidates,
      parsedCount,
      scoredCount,
      failedCount,
      scoringStatus: "NOT_STARTED",
    };
  }

  if (scoredCount < parsedCount - failedCount) {
    return {
      totalCandidates,
      parsedCount,
      scoredCount,
      failedCount,
      scoringStatus: "IN_PROGRESS",
    };
  }

  return {
    totalCandidates,
    parsedCount,
    scoredCount,
    failedCount,
    scoringStatus: "COMPLETED",
  };
};

export const sortCandidatesByScore = <T extends CandidateScoreSortItem>(candidates: T[]) => {
  return [...candidates].sort((left, right) => {
    const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
    const rightScore = right.score ?? Number.NEGATIVE_INFINITY;

    if (leftScore === rightScore) {
      return 0;
    }

    return rightScore - leftScore;
  });
};

/**
 * Create a new job opening
 */
export const createJob = async (
  title: string,
  profileDescription: string,
  organisationId: string,
  createdById: string
) => {
  const inboundEmailCode = await generateInboundEmailCode();
  const inboundEmailDomain = process.env.INBOUND_EMAIL_DOMAIN || "mail.linkup.tn";
  const inboundEmail = `${slugifyTitle(title)}-${inboundEmailCode}@${inboundEmailDomain}`;

  const job = await prisma.jobOpening.create({
    data: {
      title,
      profileDescription,
      status: "OPEN",
      organisationId,
      createdById,
      inboundEmailCode,
      inboundEmail,
    },
    select: {
      id: true,
      title: true,
      profileDescription: true,
      status: true,
      organisationId: true,
      createdById: true,
      inboundEmail: true,
      inboundEmailCode: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return job;
};

/**
 * Get paginated list of jobs for an organisation with optional status filter
 */
export const getJobsByOrganisation = async (
  organisationId: string,
  status?: string,
  page: number = 1,
  limit: number = 20
) => {
  const skip = (page - 1) * limit;

  const where: any = {
    organisationId,
  };

  // Add status filter if provided
  if (status) {
    where.status = status.toUpperCase();
  }

  // Get total count
  const total = await prisma.jobOpening.count({ where });

  // Get paginated results with candidate count
  const jobs = await prisma.jobOpening.findMany({
    where,
    select: {
      id: true,
      title: true,
      status: true,
      inboundEmail: true,
      createdAt: true,
      _count: {
        select: { candidates: true },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    skip,
    take: limit,
  });

  // Transform to include candidateCount
  const jobsWithCandidateCount = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    status: job.status,
    inboundEmail: job.inboundEmail,
    createdAt: job.createdAt,
    candidateCount: job._count.candidates,
  }));

  return {
    data: jobsWithCandidateCount,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

/**
 * Get a single job by ID and organisation (ensure ownership)
 */
export const getJobById = async (jobId: string, organisationId: string) => {
  const job = await prisma.jobOpening.findFirst({
    where: {
      id: jobId,
      organisationId,
    },
    select: {
      id: true,
      title: true,
      profileDescription: true,
      status: true,
      organisationId: true,
      createdById: true,
      inboundEmail: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { candidates: true },
      },
      candidates: {
        select: {
          status: true,
          score: true,
        },
      },
    },
  });

  if (!job) {
    throw new AppError("Job opening not found", 404, "JOB_NOT_FOUND");
  }

  const parsedCandidates = job.candidates.filter(
    (candidate) => candidate.status !== "PENDING"
  );
  const scoredCandidates = job.candidates.filter(
    (candidate) => candidate.score !== null && candidate.score !== undefined
  );

  const scoringStatusSummary = calculateScoringStatusSummary({
    totalCandidates: job.candidates.length,
    parsedCount: parsedCandidates.length,
    scoredCount: scoredCandidates.length,
    failedCount: job.candidates.filter((candidate) => candidate.status === "FAILED").length,
  });

  return {
    id: job.id,
    title: job.title,
    profileDescription: job.profileDescription,
    status: job.status,
    organisationId: job.organisationId,
    createdById: job.createdById,
    inboundEmail: job.inboundEmail,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    candidateCount: job._count.candidates,
    scoringStatus: scoringStatusSummary.scoringStatus,
  };
};

/**
 * Close a job opening
 * Only the creator or an ADMIN can close it
 */
export const closeJob = async (
  jobId: string,
  organisationId: string,
  userId: string,
  userRole: string
) => {
  // Get the job
  const job = await prisma.jobOpening.findFirst({
    where: {
      id: jobId,
      organisationId,
    },
    select: {
      id: true,
      createdById: true,
      status: true,
    },
  });

  if (!job) {
    throw new AppError("Job opening not found", 404, "JOB_NOT_FOUND");
  }

  // Check authorization: only creator or ADMIN can close
  if (userRole !== "ADMIN" && job.createdById !== userId) {
    throw new AppError(
      "You do not have permission to close this job",
      403,
      "FORBIDDEN"
    );
  }

  // Update status to CLOSED
  const updatedJob = await prisma.jobOpening.update({
    where: { id: jobId },
    data: { status: "CLOSED" },
    select: {
      id: true,
      title: true,
      profileDescription: true,
      status: true,
      organisationId: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updatedJob;
};

/**
 * Delete a candidate (and its stored file). Only ADMIN or job creator may delete.
 */
export const deleteCandidate = async (
  candidateId: string,
  jobId: string,
  organisationId: string,
  userId: string,
  userRole: string
) => {
  const job = await prisma.jobOpening.findUnique({ where: { id: jobId } });
  if (!job || job.organisationId !== organisationId) {
    throw new AppError("Job opening not found", 404, "JOB_NOT_FOUND");
  }

  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate || candidate.jobOpeningId !== jobId) {
    throw new AppError("Candidate not found", 404, "CANDIDATE_NOT_FOUND");
  }

  if (userRole !== "ADMIN" && job.createdById !== userId) {
    throw new AppError("You do not have permission to delete this candidate", 403, "FORBIDDEN");
  }

  try {
    if (candidate.rawFileUrl) {
      await deleteFile(candidate.rawFileUrl);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to delete candidate file:", err instanceof Error ? err.message : err);
  }

  await prisma.candidate.delete({ where: { id: candidateId } });
};

/**
 * Delete a job opening and its candidates (and stored files). Only ADMIN or job creator may delete.
 */
export const deleteJob = async (
  jobId: string,
  organisationId: string,
  userId: string,
  userRole: string
) => {
  const job = await prisma.jobOpening.findFirst({ where: { id: jobId, organisationId } });
  if (!job) {
    throw new AppError("Job opening not found", 404, "JOB_NOT_FOUND");
  }

  if (userRole !== "ADMIN" && job.createdById !== userId) {
    throw new AppError("You do not have permission to delete this job", 403, "FORBIDDEN");
  }

  const candidates = await prisma.candidate.findMany({ where: { jobOpeningId: jobId }, select: { id: true, rawFileUrl: true } });
  for (const c of candidates) {
    try {
      if (c.rawFileUrl) await deleteFile(c.rawFileUrl);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Failed to delete candidate file:", err instanceof Error ? err.message : err);
    }
  }

  await prisma.jobOpening.delete({ where: { id: jobId } });
};
