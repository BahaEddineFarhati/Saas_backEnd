import { Router } from "express";
import {
  getUsageSummaries,
  getUsageDetail,
  getUsageHistory,
  getPlatformTotals,
} from "@/controllers/usageController";

const router = Router();

/**
 * GET /api/v1/admin/usage
 * Paginated list of monthly usage summaries across all organisations.
 */
router.get("/", getUsageSummaries);

/**
 * GET /api/v1/admin/usage/platform-totals
 * Platform-wide aggregated token usage for current and previous month.
 * MUST be defined before /:organisationId routes to avoid param capture.
 */
router.get("/platform-totals", getPlatformTotals);

/**
 * GET /api/v1/admin/usage/:organisationId/history
 * 12 months of monthly summary history for an organisation.
 */
router.get("/:organisationId/history", getUsageHistory);

/**
 * GET /api/v1/admin/usage/:organisationId/:year/:month
 * Detailed usage breakdown for a specific organisation + month.
 */
router.get("/:organisationId/:year/:month", getUsageDetail);

export default router;
