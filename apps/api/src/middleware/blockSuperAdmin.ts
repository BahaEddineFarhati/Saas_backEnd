import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/utils/AppError';

/**
 * Middleware to block super admin from accessing client-facing routes.
 * Must be placed AFTER verifyAuthToken in the middleware chain.
 * Prevents SUPER_ADMIN from performing org-scoped operations.
 */
export const blockSuperAdmin = (
  req: Request, _res: Response, next: NextFunction
) => {
  if (req.user?.role === 'SUPER_ADMIN') {
    return next(new AppError('Super admin cannot access this resource', 403, 'FORBIDDEN'));
  }
  next();
};
