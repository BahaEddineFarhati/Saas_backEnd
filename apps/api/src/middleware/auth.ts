import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getConfig } from "@/config";
import { AppError } from "@/utils/AppError";

interface DecodedToken {
  userId: string;
  organisationId: string;
  role: string;
  type: string;
}

/**
 * Middleware that validates the JWT on every protected route.
 * Reads the Authorization header and extracts the Bearer token.
 * Throws AppError 401 with AUTH_NO_TOKEN if missing/malformed header.
 * Throws AppError 401 with AUTH_TOKEN_INVALID if verification fails.
 */
export const auth = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("No token provided or malformed authorization header", 401, "AUTH_NO_TOKEN");
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    throw new AppError("Token not provided", 401, "AUTH_TOKEN_INVALID");
  }

  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.jwtSecret) as DecodedToken;

    if (decoded.type !== "access") {
      throw new AppError("Invalid token type", 401, "AUTH_TOKEN_INVALID");
    }

    if (!decoded.userId || !decoded.organisationId || !decoded.role) {
      throw new AppError("Token payload is missing user identifiers", 401, "AUTH_TOKEN_INVALID");
    }

    req.user = {
      userId: decoded.userId,
      organisationId: decoded.organisationId,
      role: decoded.role,
    };

    next();
  } catch (error) {
    throw new AppError("Token invalid or expired", 401, "AUTH_TOKEN_INVALID");
  }
};
