import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import * as profileService from "@/services/profileService";

/**
 * GET /api/v1/profile
 * Returns the authenticated user's current profile information.
 * Includes organisation details but never returns passwordHash.
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "id": "user-id",
 *     "firstName": "John",
 *     "lastName": "Doe",
 *     "email": "john@example.com",
 *     "role": "RECRUITER",
 *     "organisation": {
 *       "id": "org-id",
 *       "name": "Organization Name",
 *       "slug": "org-name"
 *     },
 *     "createdAt": "2026-01-01T00:00:00Z"
 *   }
 * }
 */
export const getProfileController = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: {
        message: "Not authenticated",
        code: "NOT_AUTHENTICATED",
      },
    });
    return;
  }

  const profile = await profileService.getUserProfile(req.user.userId);

  res.status(200).json({
    success: true,
    data: profile,
  });
});

/**
 * PATCH /api/v1/profile
 * Allows the user to update their first name, last name, and email address.
 * All fields are optional — only provided fields are updated.
 *
 * Request body:
 * {
 *   "firstName": "John",
 *   "lastName": "Doe",
 *   "email": "john@example.com"
 * }
 *
 * Response on success (200):
 * {
 *   "success": true,
 *   "data": {
 *     "user": { id, firstName, lastName, email, role },
 *     "accessToken": "...",     // only if email changed
 *     "refreshToken": "..."     // only if email changed
 *   }
 * }
 *
 * Error (409) if email is already taken:
 * {
 *   "success": false,
 *   "error": {
 *     "message": "Email is already in use",
 *     "code": "PROFILE_EMAIL_TAKEN"
 *   }
 * }
 */
export const updateProfileController = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: {
        message: "Not authenticated",
        code: "NOT_AUTHENTICATED",
      },
    });
    return;
  }

  const { firstName, lastName, email } = req.body;

  const result = await profileService.updateUserProfile(req.user.userId, {
    firstName,
    lastName,
    email,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * PATCH /api/v1/profile/password
 * Allows the user to change their password.
 * Validates current password, validates new password requirements,
 * and rotates refresh tokens.
 *
 * Request body:
 * {
 *   "currentPassword": "OldPass1",
 *   "newPassword": "NewPass1",
 *   "confirmNewPassword": "NewPass1"
 * }
 *
 * Response on success (200):
 * {
 *   "success": true,
 *   "data": {
 *     "message": "Password updated successfully",
 *     "accessToken": "...",
 *     "refreshToken": "..."
 *   }
 * }
 *
 * Error (401) if current password is wrong:
 * {
 *   "success": false,
 *   "error": {
 *     "message": "Current password is incorrect",
 *     "code": "PROFILE_WRONG_PASSWORD"
 *   }
 * }
 *
 * Error (400) if passwords don't match:
 * {
 *   "success": false,
 *   "error": {
 *     "message": "New passwords do not match",
 *     "code": "PROFILE_PASSWORDS_DO_NOT_MATCH"
 *   }
 * }
 */
export const changePasswordController = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: {
        message: "Not authenticated",
        code: "NOT_AUTHENTICATED",
      },
    });
    return;
  }

  const { currentPassword, newPassword, confirmNewPassword } = req.body;

  const result = await profileService.changeUserPassword(req.user.userId, {
    currentPassword,
    newPassword,
    confirmNewPassword,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});
