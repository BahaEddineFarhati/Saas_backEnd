import { Request, Response } from "express";
import { CandidateStatus } from "@prisma/client";
import { catchAsync } from "@/utils/catchAsync";
import * as jobService from "@/services/jobService";
import { AppError } from "@/utils/AppError";
import { prisma } from "@/lib/prisma";
import {
  validateUploadedFiles,
  type FileValidationError,
} from "@/lib/multer";
import { uploadFile } from "@/lib/storage";
import { cvParsingQueue } from "@/lib/queue";
import type { CvParsingJobData } from "@/workers/cvParser.worker";

/**
 * POST /api/v1/jobs
 * Create a new job opening
 *
 * Request body:
 * {
 *   "title": "Senior Developer",
 *   "profileDescription": "Looking for a senior developer..."
 * }
 *
 * Response (201):
 * {
 *   "success": true,
 *   "data": { ... job object ... }
 * }
 */
export const createJob = catchAsync(async (req: Request, res: Response) => {
  const { title, profileDescription } = req.body;

  // Validate required fields
  if (!title) {
    throw new AppError("title is required", 400, "VALIDATION_ERROR");
  }
  if (!profileDescription) {
    throw new AppError(
      "profileDescription is required",
      400,
      "VALIDATION_ERROR"
    );
  }

  // Get user info from request
  const userId = req.user?.userId;
  const organisationId = req.user?.organisationId;

  if (!userId || !organisationId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  // Create the job
  const job = await jobService.createJob(
    title,
    profileDescription,
    organisationId,
    userId
  );

  res.status(201).json({
    success: true,
    data: job,
  });
});

/**
 * GET /api/v1/jobs
 * Get paginated list of job openings for the caller's organisation
 *
 * Query parameters:
 * - status: filter by OPEN or CLOSED (optional)
 * - page: page number (default 1)
 * - limit: items per page (default 20)
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "...",
 *       "title": "...",
 *       "status": "OPEN",
 *       "createdAt": "...",
 *       "candidateCount": 5
 *     }
 *   ],
 *   "pagination": {
 *     "total": 10,
 *     "page": 1,
 *     "limit": 20,
 *     "totalPages": 1
 *   }
 * }
 */
export const getJobs = catchAsync(async (req: Request, res: Response) => {
  const organisationId = req.user?.organisationId;

  if (!organisationId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  // Get query parameters
  const status = req.query.status as string | undefined;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  // Validate page and limit
  if (page < 1) {
    throw new AppError("page must be at least 1", 400, "VALIDATION_ERROR");
  }
  if (limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400, "VALIDATION_ERROR");
  }

  // Validate status if provided
  if (status && !["OPEN", "CLOSED"].includes(status.toUpperCase())) {
    throw new AppError(
      "status must be OPEN or CLOSED",
      400,
      "VALIDATION_ERROR"
    );
  }

  // Get jobs
  const result = await jobService.getJobsByOrganisation(
    organisationId,
    status,
    page,
    limit
  );

  res.status(200).json({
    success: true,
    data: result.data,
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
});

/**
 * GET /api/v1/jobs/:id
 * Get full details of a single job opening
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": { ... full job object ... }
 * }
 *
 * Response (404) if job doesn't belong to caller's organisation
 */
export const getJobById = catchAsync(async (req: Request, res: Response) => {
  const jobId = req.params.id;
  const organisationId = req.user?.organisationId;

  if (!organisationId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  const job = await jobService.getJobById(jobId, organisationId);

  res.status(200).json({
    success: true,
    data: job,
  });
});

/**
 * PATCH /api/v1/jobs/:id/close
 * Close a job opening
 * Only the creator or an ADMIN can close it
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": { ... updated job object ... }
 * }
 *
 * Response (403) if not creator or ADMIN
 */
export const closeJob = catchAsync(async (req: Request, res: Response) => {
  const jobId = req.params.id;
  const userId = req.user?.userId;
  const organisationId = req.user?.organisationId;
  const userRole = req.user?.role;

  if (!userId || !organisationId || !userRole) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  const job = await jobService.closeJob(
    jobId,
    organisationId,
    userId,
    userRole
  );

  res.status(200).json({
    success: true,
    data: job,
  });
});

/**
 * POST /api/v1/jobs/:jobId/candidates/upload
 * Upload multiple candidate files (CVs in PDF or DOCX format)
 * Validates files, stores them in R2 object storage, and creates candidate records
 *
 * Request: multipart/form-data with 'files' field containing up to 100 files
 * - Max 5MB per file
 * - Allowed types: PDF, DOCX
 *
 * Response (202):
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "candidate_id",
 *       "status": "PENDING",
 *       "rawFileUrl": "https://..."
 *     }
 *   ]
 * }
 *
 * Response (400) if validation fails
 * Response (404) if job not found or doesn't belong to organisation
 */
export const uploadCandidates = catchAsync(
  async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const organisationId = req.user?.organisationId;
    const files = req.files as Express.Multer.File[];

    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    // Validate files
    const validationErrors = validateUploadedFiles(files);
    if (validationErrors.length > 0) {
      throw new AppError(
        `File validation failed: ${validationErrors
          .map((e: FileValidationError) => `${e.filename} - ${e.reason}`)
          .join("; ")}`,
        400,
        "INVALID_FILES"
      );
    }

    // Verify job exists and belongs to organisation
    const job = await prisma.jobOpening.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new AppError("Job not found", 404, "NOT_FOUND");
    }

    if (job.organisationId !== organisationId) {
      throw new AppError(
        "Job not found",
        404,
        "NOT_FOUND"
      );
    }

    // Upload files and create candidate records
    const createdCandidates: Array<{
      id: string;
      status: string;
      rawFileUrl: string;
    }> = [];

    try {
      for (const file of files) {
        // Create unique filename for storage with job ID and timestamp
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const fileExtension = file.originalname.split(".").pop();
        const uniqueFileName = `jobs/${jobId}/${timestamp}-${random}.${fileExtension}`;

        // Upload file to R2 storage
        const rawFileUrl = await uploadFile(
          file.buffer,
          uniqueFileName,
          file.mimetype
        );

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

        createdCandidates.push({
          id: candidate.id,
          status: candidate.status,
          rawFileUrl: candidate.rawFileUrl,
        });
      }

      // Return 202 (Accepted) with created candidates
      res.status(202).json({
        success: true,
        data: createdCandidates,
      });
    } catch (error) {
      // Clean up any successfully created candidates if something fails
      if (createdCandidates.length > 0) {
        await prisma.candidate.deleteMany({
          where: {
            id: {
              in: createdCandidates.map((c) => c.id),
            },
          },
        });
      }
      throw error;
    }
  }
);

/**
 * GET /api/v1/jobs/:jobId/candidates
 * Get all candidates for a job opening with optional filtering and pagination
 *
 * Query parameters:
 * - status: filter by status (PENDING, NEW, SHORTLISTED, REJECTED, OFFERED, SCORED, FAILED)
 * - page: page number (default: 1)
 * - limit: items per page (default: 10)
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "candidates": [
 *       {
 *         "id": "candidate_id",
 *         "firstName": "John",
 *         "lastName": "Doe",
 *         "email": "john@example.com",
 *         "status": "PENDING",
 *         "score": null,
 *         "createdAt": "2026-06-22T10:00:00Z"
 *       }
 *     ],
 *     "pagination": {
 *       "page": 1,
 *       "limit": 10,
 *       "total": 45,
 *       "pages": 5
 *     }
 *   }
 * }
 *
 * Response (404) if job not found or doesn't belong to organisation
 */
export const getCandidates = catchAsync(async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const organisationId = req.user?.organisationId;

  if (!organisationId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  // Verify job exists and belongs to organisation
  const job = await prisma.jobOpening.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new AppError("Job not found", 404, "NOT_FOUND");
  }

  if (job.organisationId !== organisationId) {
    throw new AppError("Job not found", 404, "NOT_FOUND");
  }

  // Parse query parameters
  const status = req.query.status as string | undefined;
  const verdict = req.query.verdict as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));

  // Build query filter
  const where: any = {
    jobOpeningId: jobId,
  };

  if (status) {
    // Validate status value
    const validStatuses = [
      "PENDING",
      "NEW",
      "SHORTLISTED",
      "REJECTED",
      "OFFERED",
      "SCORED",
      "FAILED",
    ];
    if (!validStatuses.includes(status)) {
      throw new AppError(
        `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        400,
        "INVALID_STATUS"
      );
    }
    where.status = status;
  }

  if (verdict) {
    const validVerdicts = ["STRONG_FIT", "GOOD_FIT", "PARTIAL_FIT", "WEAK_FIT"];
    if (!validVerdicts.includes(verdict)) {
      throw new AppError(
        `Invalid verdict. Must be one of: ${validVerdicts.join(", ")}`,
        400,
        "INVALID_VERDICT"
      );
    }
  }

  const candidates = await prisma.candidate.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      status: true,
      score: true,
      scoreExplanation: true,
      summary: true,
      createdAt: true,
    },
  });

  const filteredCandidates = candidates.filter((candidate) => {
    if (!verdict) {
      return true;
    }

    const explanation = candidate.scoreExplanation as Record<string, unknown> | null;
    return explanation?.verdict === verdict;
  });

  const sortedCandidates = jobService.sortCandidatesByScore(filteredCandidates);
  const total = sortedCandidates.length;
  const pages = Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;
  const paginatedCandidates = sortedCandidates
    .slice(startIndex, startIndex + limit)
    .map((candidate) => {
      const explanation = candidate.scoreExplanation as Record<string, unknown> | null;
      return {
        ...candidate,
        scoreExplanation: explanation,
        verdict:
          typeof explanation?.verdict === "string"
            ? explanation.verdict
            : undefined,
      };
    });

  res.status(200).json({
    success: true,
    data: {
      candidates: paginatedCandidates,
      pagination: {
        page,
        limit,
        total,
        pages,
      },
    },
  });
});

/**
 * GET /api/v1/jobs/:jobId/scoring-status
 * Get lightweight scoring progress summary for a job opening
 */
export const getScoringStatus = catchAsync(async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const organisationId = req.user?.organisationId;

  if (!organisationId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  const job = await prisma.jobOpening.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new AppError("Job not found", 404, "NOT_FOUND");
  }

  if (job.organisationId !== organisationId) {
    throw new AppError("Job not found", 404, "NOT_FOUND");
  }

  const candidates = await prisma.candidate.findMany({
    where: { jobOpeningId: jobId },
    select: {
      status: true,
      score: true,
    },
  });

  const summary = jobService.calculateScoringStatusSummary({
    totalCandidates: candidates.length,
    parsedCount: candidates.filter((candidate) => candidate.status !== CandidateStatus.PENDING).length,
    scoredCount: candidates.filter((candidate) => candidate.score !== null && candidate.score !== undefined).length,
    failedCount: candidates.filter((candidate) => candidate.status === CandidateStatus.FAILED).length,
  });

  res.status(200).json({
    success: true,
    data: summary,
  });
});

/**
 * GET /api/v1/jobs/:jobId/candidates/:candidateId
 * Get full details of a single candidate including parsed CV data
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "id": "candidate_id",
 *     "firstName": "John",
 *     "lastName": "Doe",
 *     "email": "john@example.com",
 *     "status": "SCORED",
 *     "score": 0.85,
 *     "rawFileUrl": "https://...",
 *     "parsedJson": { ... },
 *     "createdAt": "2026-06-22T10:00:00Z",
 *     "updatedAt": "2026-06-22T11:00:00Z"
 *   }
 * }
 *
 * Response (404) if job or candidate not found, or doesn't belong to organisation
 */
export const getCandidateById = catchAsync(
  async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const candidateId = req.params.candidateId;
    const organisationId = req.user?.organisationId;

    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    // Verify job exists and belongs to organisation
    const job = await prisma.jobOpening.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new AppError("Job not found", 404, "NOT_FOUND");
    }

    if (job.organisationId !== organisationId) {
      throw new AppError("Job not found", 404, "NOT_FOUND");
    }

    // Get candidate and verify it belongs to this job
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
    });

    if (!candidate) {
      throw new AppError("Candidate not found", 404, "NOT_FOUND");
    }

    if (candidate.jobOpeningId !== jobId) {
      throw new AppError("Candidate not found", 404, "NOT_FOUND");
    }

    const parsedJson = candidate.parsedJson as Record<string, unknown> | null;
    const profile = parsedJson ?? {};
    const phone = parsedJson?.phone ?? parsedJson?.telephone ?? null;

    const scoreExplanation = candidate.scoreExplanation as Record<string, unknown> | null;
    const scoring = {
      score: candidate.score,
      verdict: typeof scoreExplanation?.verdict === "string" ? scoreExplanation.verdict : null,
      matchedCriteria: Array.isArray(scoreExplanation?.matchedCriteria)
        ? scoreExplanation?.matchedCriteria
        : [],
      missingCriteria: Array.isArray(scoreExplanation?.missingCriteria)
        ? scoreExplanation?.missingCriteria
        : [],
      strengths: Array.isArray(scoreExplanation?.strengths)
        ? scoreExplanation?.strengths
        : [],
    };

    const interviewQuestions = Array.isArray(candidate.interviewQuestions)
      ? (candidate.interviewQuestions as Array<unknown>).map((item) => {
          if (typeof item === "object" && item !== null) {
            const question = (item as Record<string, unknown>).question;
            const rationale = (item as Record<string, unknown>).rationale;
            return {
              question: typeof question === "string" ? question : "",
              rationale: typeof rationale === "string" ? rationale : "",
            };
          }
          return { question: "", rationale: "" };
        })
      : [];

    res.status(200).json({
      success: true,
      data: {
        id: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        phone,
        status: candidate.status,
        score: candidate.score,
        createdAt: candidate.createdAt,
        cv: {
          rawFileUrl: candidate.rawFileUrl,
        },
        profile,
        scoring,
        summary: candidate.summary,
        interviewQuestions,
      },
    });
  }
);

/**
 * PATCH /api/v1/jobs/:jobId/candidates/:candidateId/status
 * Update a candidate's status.
 */
export const updateCandidateStatus = catchAsync(
  async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const candidateId = req.params.candidateId;
    const organisationId = req.user?.organisationId;

    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    const { status } = req.body;
    if (!status || typeof status !== "string") {
      throw new AppError("status is required", 400, "VALIDATION_ERROR");
    }

    if (
      status !== CandidateStatus.SHORTLISTED &&
      status !== CandidateStatus.REJECTED
    ) {
      throw new AppError(
        "Only SHORTLISTED and REJECTED are allowed",
        400,
        "INVALID_STATUS"
      );
    }

    const job = await prisma.jobOpening.findUnique({ where: { id: jobId } });
    if (!job || job.organisationId !== organisationId) {
      throw new AppError("Job not found", 404, "NOT_FOUND");
    }

    const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate || candidate.jobOpeningId !== jobId) {
      throw new AppError("Candidate not found", 404, "NOT_FOUND");
    }

    const updatedCandidate = await prisma.candidate.update({
      where: { id: candidateId },
      data: { status: status as CandidateStatus },
      select: {
        id: true,
        status: true,
      },
    });

    res.status(200).json({
      success: true,
      data: updatedCandidate,
    });
  }
);

/**
 * DELETE /api/v1/jobs/:jobId/candidates/:candidateId
 * Delete a candidate. Only ADMIN or job creator may delete.
 */
export const deleteCandidate = catchAsync(
  async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const candidateId = req.params.candidateId;
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    const organisationId = req.user?.organisationId;

    if (!userId || !userRole || !organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    await jobService.deleteCandidate(candidateId, jobId, organisationId, userId, userRole);

    res.status(200).json({ success: true, message: "Candidate deleted" });
  }
);

/**
 * DELETE /api/v1/jobs/:id
 * Delete a job opening and its candidates. Only ADMIN or job creator may delete.
 */
export const deleteJob = catchAsync(async (req: Request, res: Response) => {
  const jobId = req.params.id;
  const userId = req.user?.userId;
  const userRole = req.user?.role;
  const organisationId = req.user?.organisationId;

  if (!userId || !userRole || !organisationId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  await jobService.deleteJob(jobId, organisationId, userId, userRole);

  res.status(200).json({ success: true, message: "Job deleted" });
});
