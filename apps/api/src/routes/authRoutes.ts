import { Router } from "express";
import { catchAsync } from "@/utils/catchAsync";
import {
  loginController,
  logoutController,
  refreshTokenController,
} from "@/controllers/authController";

const router = Router();

/**
 * POST /api/v1/auth/login
 * Login with email and password
 * Returns access token and refresh token
 */
router.post("/login", catchAsync(loginController));

/**
 * POST /api/v1/auth/logout
 * Logout by invalidating refresh token
 */
router.post("/logout", catchAsync(logoutController));

/**
 * POST /api/v1/auth/refresh
 * Refresh access token using refresh token
 */
router.post("/refresh", catchAsync(refreshTokenController));

export default router;
