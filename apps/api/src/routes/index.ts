import { Router, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import authRoutes from "@/routes/authRoutes";
import jobRoutes from "@/routes/jobRoutes";

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

export default router;
