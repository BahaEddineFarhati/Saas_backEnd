import { Router, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import authRoutes from "@/routes/authRoutes";
import jobRoutes from "@/routes/jobRoutes";
import organisationRoutes from "@/routes/organisationRoutes";
import adminRoutes from "@/routes/adminRoutes";
import dashboardRoutes from "@/routes/dashboardRoutes";
import notificationRoutes from "@/routes/notificationRoutes";
import profileRoutes from "@/routes/profileRoutes";
import { verifyAuthToken } from "@/middleware/authMiddleware";
import { requireSuperAdmin } from "@/middleware/requireSuperAdmin";

const router = Router();

/**
  * GET /api/v1
  * Root API v1 endpoint - confirms routing is working
  */
router.get(
  "/",
  catchAsync(async (_req, res: Response) => {
    res.status(200).json({
      success: true,
      message: "API v1",
    });
  })
);

/**
 * GET /api/v1/protected-test
 * Protected route to verify auth middleware functionality
 */
router.get(
  "/protected-test",
  verifyAuthToken,
  catchAsync(async (req, res: Response) => {
    res.status(200).json({
      success: true,
      user: req.user,
    });
  })
);

/**
 * Mount auth routes at /auth
 * POST /api/v1/auth/login
 * POST /api/v1/auth/logout
 * POST /api/v1/auth/refresh
 * POST /api/v1/auth/accept-invite
 */
router.use("/auth", authRoutes);

/**
 * Mount job routes at /jobs
 * POST /api/v1/jobs
 * GET /api/v1/jobs
 * GET /api/v1/jobs/:id
 * PATCH /api/v1/jobs/:id/close
 */
router.use("/jobs", jobRoutes);

/**
 * Mount organisation routes at /organisation
 * GET    /api/v1/organisation
 * PATCH  /api/v1/organisation
 * GET    /api/v1/organisation/members
 * PATCH  /api/v1/organisation/members/:userId/role
 * DELETE /api/v1/organisation/members/:userId
 * POST   /api/v1/organisation/members/invite
 */
router.use("/organisation", organisationRoutes);

/**
 * Mount dashboard routes at /dashboard
 * GET /api/v1/dashboard/stats
 * GET /api/v1/dashboard/recent-job-openings
 * GET /api/v1/dashboard/recent-activity
 * GET /api/v1/dashboard/charts/candidates-over-time
 * GET /api/v1/dashboard/charts/parsing-status
 * GET /api/v1/dashboard/charts/openings-funnel
 */
router.use("/dashboard", dashboardRoutes);

/**
 * Mount notification routes at /notifications
 * Protected: requires authentication
 */
router.use("/notifications", verifyAuthToken, notificationRoutes);

/**
 * Mount profile routes at /profile
 * GET    /api/v1/profile
 * PATCH  /api/v1/profile
 * PATCH  /api/v1/profile/password
 * Protected: requires authentication
 */
router.use("/profile", verifyAuthToken, profileRoutes);

/**
 * Mount super admin routes at /admin
 * Protected: requires SUPER_ADMIN role
 */
router.use("/admin", verifyAuthToken, requireSuperAdmin, adminRoutes);

export default router;

