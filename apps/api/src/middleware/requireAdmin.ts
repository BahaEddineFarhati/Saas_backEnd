import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/AppError";

/**
 * Middleware that restricts access to ADMIN role only.
 * Must be placed AFTER verifyAuthToken in the middleware chain.
 * Returns 403 for any non-admin caller.
 */
export const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== "ADMIN") {
    return next(new AppError("Admin access required", 403, "FORBIDDEN"));
  }
  next();
};
