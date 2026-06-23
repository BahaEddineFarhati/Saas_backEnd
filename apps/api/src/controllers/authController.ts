import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import * as authService from "@/services/authService";
import type { LoginResponse, RefreshTokenResponse } from "@/types";
import { prisma } from "@/lib/prisma";


/**
 * POST /api/v1/auth/login
 * Authenticates user with email and password.
 * Returns both access token and refresh token on success.
 *
 * Request body:
 * {
 *   "email": "user@example.com",
 *   "password": "password123"
 * }
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "accessToken": "...",
 *     "refreshToken": "...",
 *     "user": { ... }
 *   }
 * }
 *
 * Error (401):
 * {
 *   "success": false,
 *   "error": {
 *     "message": "Invalid email or password",
 *     "code": "INVALID_CREDENTIALS"
 *   }
 * }
 */
export const loginController = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    res.status(400).json({
      success: false,
      error: {
        message: "Email and password are required",
        code: "INVALID_INPUT",
      },
    });
    return;
  }

  const result: LoginResponse = await authService.login(email, password);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/auth/logout
 * Logs out user by invalidating their refresh token.
 * Idempotent - returns success even if token doesn't exist.
 *
 * Request body:
 * {
 *   "refreshToken": "..."
 * }
 *
 * Response (200):
 * {
 *   "success": true,
 *   "message": "Logged out successfully"
 * }
 */
export const logoutController = catchAsync(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  // Validate input
  if (!refreshToken) {
    res.status(400).json({
      success: false,
      error: {
        message: "Refresh token is required",
        code: "INVALID_INPUT",
      },
    });
    return;
  }

  await authService.logout(refreshToken);

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

/**
 * POST /api/v1/auth/refresh
 * Refreshes the access token using a valid refresh token.
 * Returns new access token on success.
 *
 * Request body:
 * {
 *   "refreshToken": "..."
 * }
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "accessToken": "..."
 *   }
 * }
 *
 * Error (401):
 * {
 *   "success": false,
 *   "error": {
 *     "message": "Invalid or expired refresh token",
 *     "code": "INVALID_REFRESH_TOKEN"
 *   }
 * }
 */
export const refreshTokenController = catchAsync(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  // Validate input
  if (!refreshToken) {
    res.status(400).json({
      success: false,
      error: {
        message: "Refresh token is required",
        code: "INVALID_INPUT",
      },
    });
    return;
  }

  const result: RefreshTokenResponse = await authService.refreshAccessToken(refreshToken);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/auth/accept-invite
 * Accept an invitation and create a new user account.
 * Public endpoint — no authentication required.
 *
 * Request body:
 * {
 *   "token": "invite-token-string",
 *   "firstName": "Jane",
 *   "lastName": "Doe",
 *   "password": "SecurePass1"
 * }
 */
export const acceptInviteController = catchAsync(async (req: Request, res: Response) => {
  const { token, firstName, lastName, password } = req.body;

  if (!token || !firstName || !lastName || !password) {
    res.status(400).json({
      success: false,
      error: {
        message: "token, firstName, lastName, and password are required",
        code: "VALIDATION_ERROR",
      },
    });
    return;
  }

  // Password validation
  if (password.length < 8) {
    res.status(400).json({
      success: false,
      error: { message: "Password must be at least 8 characters long", code: "VALIDATION_ERROR" },
    });
    return;
  }
  if (!/[A-Z]/.test(password)) {
    res.status(400).json({
      success: false,
      error: { message: "Password must contain at least one uppercase letter", code: "VALIDATION_ERROR" },
    });
    return;
  }
  if (!/[0-9]/.test(password)) {
    res.status(400).json({
      success: false,
      error: { message: "Password must contain at least one number", code: "VALIDATION_ERROR" },
    });
    return;
  }

  const result = await authService.acceptInvite({ token, firstName, lastName, password });

  res.status(201).json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/v1/auth/me
 * Retrieves current authenticated user details from DB.
 */
export const meController = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ success: false, error: { message: "Not authenticated", code: "NOT_AUTHENTICATED" } });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      organisationId: true,
    },
  });

  if (!user) {
    res.status(401).json({
      success: false,
      error: {
        message: "User not found",
        code: "USER_NOT_FOUND",
      },
    });
    return;
  }

  res.status(200).json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`,
        role: user.role,
        organisationId: user.organisationId,
      },
    },
  });
});
