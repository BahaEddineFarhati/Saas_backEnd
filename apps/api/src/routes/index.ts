import { Router, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import authRoutes from "@/routes/authRoutes";

const router = Router();

router.get(
  "/",
  catchAsync(async (_req, res: Response) => {
    res.status(200).json({
      success: true,
      message: "API v1",
    });
  })
);

// POST /api/v1/auth/login, /register, /logout, /refresh, /invite
router.use("/auth", authRoutes);

export default router;
