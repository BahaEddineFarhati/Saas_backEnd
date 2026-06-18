import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import * as jobService from "@/services/jobService";
import { AppError } from "@/utils/AppError";
import { validateUploadedFiles } from "@/lib/multer";
import {
  uploadFileToStorage,
  getPublicFileUrl,
} from "@/lib/supabaseStorage";
import { prisma } from "@/lib/prisma";

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
 * Validates files, stores them in object storage, and creates candidate records
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
          .map((e) => `${e.filename} - ${e.reason}`)
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
        // Upload file to Supabase Storage
        const { bucket, path } = await uploadFileToStorage(
          file,
          jobId
        );

        // Generate public URL
        const rawFileUrl = getPublicFileUrl(bucket, path);

        // Create candidate record with PENDING status
        const candidate = await prisma.candidate.create({
          data: {
            firstName: "", // Will be populated during parsing
            lastName: "",
            email: "",
            rawFileUrl,
            status: "PENDING",
            jobOpeningId: jobId,
          },
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
