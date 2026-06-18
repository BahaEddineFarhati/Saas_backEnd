import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import * as authService from "@/services/authService";
import type { LoginResponse, RefreshTokenResponse } from "@/types";





export const register = catchAsync(async (req: Request, res: Response) => {
  const validatedData = (req as any).validatedData || req.body;
  const result = await authService.register(validatedData);
  
  // Return exactly the specified response structure
  res.status(201).json(result);
});


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

