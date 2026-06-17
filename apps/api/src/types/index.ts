import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/AppError";

/**
 * Type definition for async middleware/controller handlers.
 * Wraps handlers to catch promise rejections and forward to error handler.
 */
export type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void> | void;

/**
 * Type definition for error handlers.
 * Must have 4 parameters to be recognized by Express as error middleware.
 */
export type ErrorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => void;

/**
 * Standard API response structure.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message: string;
  };
}

/**
 * Health check response structure.
 */
export interface HealthCheckResponse {
  status: "ok" | "error";
  timestamp: string;
  environment: string;
}
/**
 * Response type for login endpoint.
 * Contains both access and refresh tokens.
 */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    organisationId: string;
  };
}
/**
 * Response type for token refresh endpoint.
 * Contains new access token.
 */
export interface RefreshTokenResponse {
  accessToken: string;
}
export interface RegisterInput {
  organisationName: string;
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
}