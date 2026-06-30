import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/utils/AppError';

/**
 * Middleware that restricts access to SUPER_ADMIN role only.
 * Must be placed AFTER verifyAuthToken in the middleware chain.
 * Returns 403 for any non-super-admin caller.
 */
export const requireSuperAdmin = (
  req: Request, _res: Response, next: NextFunction
) => {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
  }
  next();
};
