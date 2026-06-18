import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getConfig } from "@/config";
import { AppError } from "@/utils/AppError";
import { prisma } from "@/lib/prisma";

interface DecodedToken {
  userId: string;
  organisationId?: string;
  role?: string;
  type: string;
}

/**
 * Middleware that validates the JWT on every protected route.
 * Reads the Authorization header and extracts the Bearer token.
 * Throws AppError 401 with AUTH_NO_TOKEN if missing/malformed header.
 * Throws AppError 401 with AUTH_TOKEN_INVALID if verification fails.
 * Falls back to database query if organisationId or role are missing from token payload.
 */
export const auth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(new AppError("No token provided or malformed authorization header", 401, "AUTH_NO_TOKEN"));
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return next(new AppError("Token not provided", 401, "AUTH_TOKEN_INVALID"));
    }

    let decoded: DecodedToken;
    try {
      const config = getConfig();
      decoded = jwt.verify(token, config.jwtSecret) as DecodedToken;
    } catch (err) {
      return next(new AppError("Token invalid or expired", 401, "AUTH_TOKEN_INVALID"));
    }

    if (decoded.type !== "access") {
      return next(new AppError("Invalid token type", 401, "AUTH_TOKEN_INVALID"));
    }

    const userId = decoded.userId;
    if (!userId) {
      return next(new AppError("Token payload is missing user identifiers", 401, "AUTH_TOKEN_INVALID"));
    }

    let organisationId = decoded.organisationId;
    let role = decoded.role;

    // Fallback: If token was generated before the metadata was added to JWT, fetch from DB
    if (!organisationId || !role) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        return next(new AppError("User not found", 401, "AUTH_TOKEN_INVALID"));
      }
      organisationId = user.organisationId;
      role = user.role;
    }

    req.user = {
      userId,
      organisationId,
      role,
    };

    next();
  } catch (error) {
    next(error);
  }
};
