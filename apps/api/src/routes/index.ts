import { Router, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import authRoutes from "@/routes/authRoutes";
import jobRoutes from "@/routes/jobRoutes";
import organisationRoutes from "@/routes/organisationRoutes";
import { auth } from "@/middleware/auth";

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
 * Mount auth routes at /auth
 * POST /api/v1/auth/login
 * POST /api/v1/auth/logout
 * POST /api/v1/auth/refresh
 * POST /api/v1/auth/accept-invite
 */
router.use("/auth", authRoutes);

/**
 * GET /api/v1/protected-test
 * Protected route to verify auth middleware functionality
 */
router.get(
  "/protected-test",
  auth,
  catchAsync(async (req, res: Response) => {
    res.status(200).json({
      success: true,
      user: req.user,
    });
  })
);

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

export default router;
