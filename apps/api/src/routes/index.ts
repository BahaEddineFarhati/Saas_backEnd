import { Router, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";

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

export default router;
