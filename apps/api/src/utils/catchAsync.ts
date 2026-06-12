import { Request, Response, NextFunction } from "express";
import type { AsyncHandler } from "@/types";

/**
 * Wraps async route handlers to automatically catch errors and forward to express error handler.
 * Eliminates the need for try/catch blocks in controllers.
 *
 * Usage: router.get("/path", catchAsync(async (req, res) => { ... }))
 */
export const catchAsync = (fn: AsyncHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
