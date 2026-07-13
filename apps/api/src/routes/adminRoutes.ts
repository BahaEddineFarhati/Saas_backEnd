import { Router } from "express";
import {
  createOrganisation,
  listOrganisations,
  getOrganisationById,
  updateOrganisation,
  suspendOrganisation,
  unsuspendOrganisation,
  getStats,
} from "@/controllers/adminController";
import usageRoutes from "@/routes/usageRoutes";

const router = Router();

/**
 * GET /api/v1/admin/stats
 * Platform-wide statistics dashboard
 */
router.get("/stats", getStats);

/**
 * POST /api/v1/admin/organisations
 * Create a new organisation with its admin user
 */
router.post("/organisations", createOrganisation);

/**
 * GET /api/v1/admin/organisations
 * List organisations with pagination, search, and filter
 */
router.get("/organisations", listOrganisations);

/**
 * GET /api/v1/admin/organisations/:orgId
 * Get full details of a single organisation
 */
router.get("/organisations/:orgId", getOrganisationById);

/**
 * PATCH /api/v1/admin/organisations/:orgId
 * Partial update organisation (name, slug, plan)
 */
router.patch("/organisations/:orgId", updateOrganisation);

/**
 * POST /api/v1/admin/organisations/:orgId/suspend
 * Suspend an organisation
 */
router.post("/organisations/:orgId/suspend", suspendOrganisation);

/**
 * POST /api/v1/admin/organisations/:orgId/unsuspend
 * Unsuspend an organisation
 */
router.post("/organisations/:orgId/unsuspend", unsuspendOrganisation);

/**
 * Mount LLM usage tracking routes at /usage
 * GET /api/v1/admin/usage
 * GET /api/v1/admin/usage/platform-totals
 * GET /api/v1/admin/usage/:organisationId/history
 * GET /api/v1/admin/usage/:organisationId/:year/:month
 */
router.use("/usage", usageRoutes);

export default router;
