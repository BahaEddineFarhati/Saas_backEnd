import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { deleteFile } from "@/lib/storage";

/**
 * Create a new job opening
 */
export const createJob = async (
  title: string,
  profileDescription: string,
  organisationId: string,
  createdById: string
) => {
  const job = await prisma.jobOpening.create({
    data: {
      title,
      profileDescription,
      status: "OPEN",
      organisationId,
      createdById,
    },
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
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { candidates: true },
      },
    },
  });

  if (!job) {
    throw new AppError("Job opening not found", 404, "JOB_NOT_FOUND");
  }

  return {
    id: job.id,
    title: job.title,
    profileDescription: job.profileDescription,
    status: job.status,
    organisationId: job.organisationId,
    createdById: job.createdById,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    candidateCount: job._count.candidates,
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
