import { Router } from "express";
import { catchAsync } from "@/utils/catchAsync";
import { verifyAuthToken } from "@/middleware/authMiddleware";
import {
  getProfileController,
  updateProfileController,
  changePasswordController,
} from "@/controllers/profileController";

const router = Router();

/**
 * GET /api/v1/profile
 * Get current authenticated user's profile information.
 * Requires authentication.
 */
router.get("/", verifyAuthToken, catchAsync(getProfileController));

/**
 * PATCH /api/v1/profile
 * Update user's profile (firstName, lastName, email).
 * If email changes, returns new access and refresh tokens.
 * Requires authentication.
 */
router.patch("/", verifyAuthToken, catchAsync(updateProfileController));

/**
 * PATCH /api/v1/profile/password
 * Change user's password.
 * Returns new access and refresh tokens.
 * Requires authentication.
 */
router.patch("/password", verifyAuthToken, catchAsync(changePasswordController));

export default router;
