import { Router, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import authRoutes from "@/routes/authRoutes";

const router = Router();

// Mount authentication routes under /auth
router.use("/auth", authRoutes);

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
 */
router.use("/auth", authRoutes);

export default router;
