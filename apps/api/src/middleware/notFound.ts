import { Request, Response } from "express";
import { AppError } from "@/utils/AppError";
import { catchAsync } from "@/utils/catchAsync";

/**
 * 404 Not Found handler middleware.
 * Catches any request that reaches this middleware and returns a 404 error.
 *
 * Must be registered after all route definitions.
 */
const notFound = catchAsync((req: Request, _res: Response) => {
  const message = `Route ${req.method} ${req.path} not found`;
  throw new AppError(message, 404, "ROUTE_NOT_FOUND");
});

export default notFound;
