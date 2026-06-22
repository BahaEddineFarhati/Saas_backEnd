import { Router } from "express";
import {
  createJob,
  getJobs,
  getJobById,
  closeJob,
} from "@/controllers/jobController";
import { verifyAuthToken } from "@/middleware/authMiddleware";

const router = Router();

/**
 * POST /api/v1/jobs
 * Create a new job opening
 * Protected: requires authentication
 */
router.post("/", verifyAuthToken, createJob);

/**
 * GET /api/v1/jobs
 * Get paginated list of job openings for the caller's organisation
 * Supports status filter and pagination
 * Protected: requires authentication
 */
router.get("/", verifyAuthToken, getJobs);

/**
 * GET /api/v1/jobs/:id
 * Get full details of a single job opening
 * Protected: requires authentication
 */
router.get("/:id", verifyAuthToken, getJobById);

/**
 * PATCH /api/v1/jobs/:id/close
 * Close a job opening
 * Only the creator or an ADMIN can close it
 * Protected: requires authentication
 */
router.patch("/:id/close", verifyAuthToken, closeJob);

export default router;
