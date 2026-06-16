import jwt from "jsonwebtoken";
import { getConfig } from "@/config";
import type { JwtPayload } from "jsonwebtoken";

/**
 * JWT token payload interface.
 * Contains user ID for token identification.
 */
export interface TokenPayload {
  userId: string;
  type: "access" | "refresh";
}

/**
 * Generates an access token with 15-minute expiration.
 * Used for authenticating API requests.
 */
export const generateAccessToken = (userId: string): string => {
  const config = getConfig();
  const payload: TokenPayload = {
    userId,
    type: "access",
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: "15m",
    algorithm: "HS256",
  });
};

/**
 * Generates a refresh token with 7-day expiration.
 * Used to obtain new access tokens without requiring login.
 */
export const generateRefreshToken = (userId: string): string => {
  const config = getConfig();
  const payload: TokenPayload = {
    userId,
    type: "refresh",
  };

  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
};

/**
 * Verifies and decodes an access token.
 * Returns the decoded payload if valid, null if verification fails.
 */
export const verifyAccessToken = (token: string): TokenPayload | null => {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
    }) as JwtPayload;

    // Verify token type
    if (decoded.type !== "access") {
      return null;
    }

    return {
      userId: decoded.userId,
      type: "access",
    };
  } catch (error) {
    return null;
  }
};

/**
 * Verifies and decodes a refresh token.
 * Returns the decoded payload if valid, null if verification fails.
 */
export const verifyRefreshToken = (token: string): TokenPayload | null => {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.jwtRefreshSecret, {
      algorithms: ["HS256"],
    }) as JwtPayload;

    // Verify token type
    if (decoded.type !== "refresh") {
      return null;
    }

    return {
      userId: decoded.userId,
      type: "refresh",
    };
  } catch (error) {
    return null;
  }
};

/**
 * Extracts expiration time from a token without verifying it.
 * Useful for determining when a token will expire.
 */
export const getTokenExpiration = (token: string): Date | null => {
  try {
    const decoded = jwt.decode(token) as JwtPayload | null;
    if (!decoded || !decoded.exp) {
      return null;
    }
    return new Date(decoded.exp * 1000);
  } catch (error) {
    return null;
  }
};
