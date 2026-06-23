import { Router } from "express";
import { verifyAuthToken } from "@/middleware/authMiddleware";
import { requireAdmin } from "@/middleware/requireAdmin";
import {
  getOrganisation,
  updateOrganisation,
  getMembers,
  updateMemberRole,
  deactivateMember,
  inviteMember,
} from "@/controllers/organisationController";

const router = Router();

// All routes require authentication + admin role
router.use(verifyAuthToken, requireAdmin);

/**
 * GET /api/v1/organisation
 * Returns organisation details (name, slug, plan, createdAt)
 */
router.get("/", getOrganisation);

/**
 * PATCH /api/v1/organisation
 * Updates organisation name and/or slug
 */
router.patch("/", updateOrganisation);

/**
 * GET /api/v1/organisation/members
 * Returns all users belonging to the organisation
 */
router.get("/members", getMembers);

/**
 * PATCH /api/v1/organisation/members/:userId/role
 * Changes a member's role (ADMIN <-> RECRUITER)
 */
router.patch("/members/:userId/role", updateMemberRole);

/**
 * DELETE /api/v1/organisation/members/:userId
 * Deactivates a member and revokes their sessions
 */
router.delete("/members/:userId", deactivateMember);

/**
 * POST /api/v1/organisation/members/invite
 * Sends an invite to a new team member by email
 */
router.post("/members/invite", inviteMember);

export default router;
