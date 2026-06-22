import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/AppError";
import { verifyAccessToken } from "@/utils/jwt";
import { prisma } from "@/lib/prisma";
import { catchAsync } from "@/utils/catchAsync";

/**
 * Middleware to verify access token from Authorization header.
 * Extracts token from "Bearer <token>" format.
 * Verifies token signature and type.
 *
 * Sets req.user with decoded token payload if successful.
 * Throws AppError if token is missing, malformed, or invalid.
 *
 * Usage: router.get("/protected", verifyAuthToken, controller)
 */
export const verifyAuthToken = catchAsync(
  async (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new AppError("Authorization header is missing", 401, "MISSING_AUTH_HEADER");
  }

  // Extract token from "Bearer <token>" format
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new AppError(
      "Invalid authorization header format. Expected 'Bearer <token>'",
      401,
      "INVALID_AUTH_FORMAT"
    );
  }

  const token = parts[1];

  // Verify token
  const payload = verifyAccessToken(token);

  if (!payload) {
    throw new AppError("Invalid or expired access token", 401, "INVALID_ACCESS_TOKEN");
  }

  // Fetch user details from database
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      organisationId: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 401, "USER_NOT_FOUND");
  }

  if (!user.isActive) {
    throw new AppError("Account deactivated", 401, "ACCOUNT_DEACTIVATED");
  }

    // Attach user to request
    req.user = {
      ...payload,
      organisationId: user.organisationId,
      role: user.role,
    };

    next();
  }
);
