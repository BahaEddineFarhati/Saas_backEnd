import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/AppError";
import { verifyAccessToken } from "@/utils/jwt";

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
export const verifyAuthToken = (
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

  // Attach user to request
  req.user = {
    userId: payload.userId,
    organisationId: payload.organisationId || "",
    role: payload.role || "",
  };

  next();
};
