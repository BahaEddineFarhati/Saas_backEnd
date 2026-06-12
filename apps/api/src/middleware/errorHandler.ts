import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/AppError";
import type { ErrorHandler } from "@/types";

/**
 * Global error handling middleware.
 * Must have 4 parameters (err, req, res, next) to be recognized by Express.
 *
 * Handles:
 * - AppError instances (operational errors)
 * - Prisma P2002 unique constraint violations (409 Conflict)
 * - Prisma P2025 record not found (404 Not Found)
 * - All other errors (500 Internal Server Error)
 *
 * In development, includes full stack trace. In production, generic message.
 */
const errorHandler: ErrorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Default error properties
  let statusCode = 500;
  let code: string | undefined;
  let message = "Something went wrong";

  // Handle AppError (operational errors)
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  }
  // Handle Prisma unique constraint violation
  else if (err.message?.includes("P2002")) {
    statusCode = 409;
    code = "UNIQUE_CONSTRAINT_VIOLATION";
    message = "A record with this value already exists";
  }
  // Handle Prisma record not found
  else if (err.message?.includes("P2025")) {
    statusCode = 404;
    code = "RECORD_NOT_FOUND";
    message = "Resource not found";
  }

  // Log the error
  console.error(`[${statusCode}]`, {
    code,
    message,
    originalError: process.env.NODE_ENV === "development" ? err.message : undefined,
  });

  // Send response
  const response: any = {
    success: false,
    error: {
      code,
      message,
    },
  };

  // Include stack trace only in development
  if (process.env.NODE_ENV === "development" && !(err instanceof AppError)) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

export default errorHandler;
