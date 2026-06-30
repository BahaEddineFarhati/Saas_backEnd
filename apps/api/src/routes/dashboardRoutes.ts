import { Router } from "express";
import {
  getDashboardStats,
  getRecentJobOpenings,
  getRecentActivity,
  getCandidatesOverTime,
  getParsingStatus,
  getOpeningsFunnel,
} from "@/controllers/dashboardController";
import { verifyAuthToken } from "@/middleware/authMiddleware";
import { blockSuperAdmin } from "@/middleware/blockSuperAdmin";

const router = Router();

/**
 * GET /api/v1/dashboard/stats
 * Returns aggregate counts for the caller's organisation:
 * activeJobOpenings, totalJobOpenings, totalCandidatesUploaded,
 * candidatesUploadedThisMonth, candidatesPendingParsing,
 * candidatesParsedSuccessfully, candidatesFailedParsing, teamMembersCount
 */
router.get("/stats", verifyAuthToken, blockSuperAdmin, getDashboardStats);

/**
 * GET /api/v1/dashboard/recent-job-openings
 * Returns the 5 most recently active job openings (by updatedAt desc).
 * Each includes: id, title, status, candidateCount, parsedCount, updatedAt
 */
router.get(
  "/recent-job-openings",
  verifyAuthToken,
  blockSuperAdmin,
  getRecentJobOpenings
);

/**
 * GET /api/v1/dashboard/recent-activity
 * Returns the 10 most recent events for the organisation, derived from
 * existing table timestamps (job created, CVs uploaded, job closed).
 * Each event: { type, message, jobOpeningId, jobOpeningTitle, timestamp, timeAgo }
 */
router.get(
  "/recent-activity",
  verifyAuthToken,
  blockSuperAdmin,
  getRecentActivity
);

/**
 * GET /api/v1/dashboard/charts/candidates-over-time
 * Query param: range = "7d" | "30d" | "90d" (default "30d")
 * Returns daily CV upload counts as a continuous series (zero-filled).
 * { data: [{ date: "2026-06-01", count: 12 }, ...] }
 */
router.get(
  "/charts/candidates-over-time",
  verifyAuthToken,
  blockSuperAdmin,
  getCandidatesOverTime
);

/**
 * GET /api/v1/dashboard/charts/parsing-status
 * Returns candidate counts grouped by parsing status (PENDING, SCORED, FAILED).
 * { data: [{ status: "PENDING", count: 12 }, ...] }
 */
router.get(
  "/charts/parsing-status",
  verifyAuthToken,
  blockSuperAdmin,
  getParsingStatus
);

/**
 * GET /api/v1/dashboard/charts/openings-funnel
 * Returns simplified hiring funnel aggregate counts.
 * { data: [{ stage: "Offres ouvertes", count: 6 }, ...] }
 */
router.get(
  "/charts/openings-funnel",
  verifyAuthToken,
  blockSuperAdmin,
  getOpeningsFunnel
);

export default router;
