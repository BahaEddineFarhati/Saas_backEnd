import { Router } from "express";
import {
  createJob,
  getJobs,
  getJobById,
  closeJob,
  uploadCandidates,
  downloadCandidateCv,
  getCandidates,
  getCandidateById,
  compareCandidates,
  updateCandidateStatus,
  getScoringStatus,
  deleteCandidate,
  deleteJob,
} from "@/controllers/jobController";
import { exportJobPdf } from "@/controllers/pdfExportController";
import chatRoutes from "@/routes/chatRoutes";
import { verifyAuthToken } from "@/middleware/authMiddleware";
import { blockSuperAdmin } from "@/middleware/blockSuperAdmin";
import { uploadMiddleware } from "@/lib/multer";

const router = Router();

/**
 * POST /api/v1/jobs
 * Create a new job opening
 * Protected: requires authentication
 */
router.post("/", verifyAuthToken, blockSuperAdmin, createJob);

/**
 * GET /api/v1/jobs
 * Get paginated list of job openings for the caller's organisation
 * Supports status filter and pagination
 * Protected: requires authentication
 */
router.get("/", verifyAuthToken, blockSuperAdmin, getJobs);

/**
 * GET /api/v1/jobs/:jobId/scoring-status
 * Get lightweight scoring progress summary for a job opening
 * Protected: requires authentication
 */
router.get("/:jobId/scoring-status", verifyAuthToken, blockSuperAdmin, getScoringStatus);

/**
 * GET /api/v1/jobs/:jobId/candidates
 * Get all candidates for a job opening with optional filtering and pagination
 * Query params: status, verdict, page, limit
 * Protected: requires authentication
 */
router.get("/:jobId/candidates", verifyAuthToken, blockSuperAdmin, getCandidates);

/**
 * GET /api/v1/jobs/:jobId/candidates/compare?ids=id1,id2
 * Compare exactly two candidates side by side
 * Returns an array of exactly 2 full candidate objects
 * Protected: requires authentication
 */
router.get("/:jobId/candidates/compare", verifyAuthToken, blockSuperAdmin, compareCandidates);

/**
 * GET /api/v1/jobs/:jobId/candidates/:candidateId
 * Get full details of a specific candidate including parsed CV data
 * Protected: requires authentication
 */
router.get("/:jobId/candidates/:candidateId", verifyAuthToken, blockSuperAdmin, getCandidateById);

/**
 * PATCH /api/v1/jobs/:jobId/candidates/:candidateId/status
 * Update a candidate's status to SHORTLISTED or REJECTED.
 * Protected: requires authentication
 */
router.patch(
  "/:jobId/candidates/:candidateId/status",
  verifyAuthToken,
  blockSuperAdmin,
  updateCandidateStatus
);

/**
 * GET /api/v1/jobs/:jobId/export/pdf
 * Generate and download a PDF report of scored candidates
 * Protected: requires authentication
 */
router.get("/:jobId/export/pdf", verifyAuthToken, blockSuperAdmin, exportJobPdf);

/**
 * /api/v1/jobs/:jobId/chat/*
 * AI chat assistant sub-routes for this job opening
 * Protected: requires authentication
 */
router.use("/:jobId/chat", chatRoutes);

/**
 * GET /api/v1/jobs/:id
 * Get full details of a single job opening
 * Protected: requires authentication
 */
router.get("/:id", verifyAuthToken, blockSuperAdmin, getJobById);

/**
 * PATCH /api/v1/jobs/:id/close
 * Close a job opening
 * Only the creator or an ADMIN can close it
 * Protected: requires authentication
 */
router.patch("/:id/close", verifyAuthToken, blockSuperAdmin, closeJob);

/**
 * POST /api/v1/jobs/:jobId/candidates/upload
 * Upload multiple candidate files (CVs)
 * Accepts up to 100 files, max 5MB each
 * Allowed types: PDF, DOCX
 * Protected: requires authentication
 */
router.post(
  "/:jobId/candidates/upload",
  verifyAuthToken,
  blockSuperAdmin,
  uploadMiddleware.array("files", 100),
  uploadCandidates
);

router.get(
  "/:jobId/candidates/:candidateId/download",
  verifyAuthToken,
  blockSuperAdmin,
  downloadCandidateCv
);

// Delete a candidate
router.delete(
  "/:jobId/candidates/:candidateId",
  verifyAuthToken,
  deleteCandidate
);

// Delete a job opening
router.delete("/:id", verifyAuthToken, deleteJob);

export default router;

