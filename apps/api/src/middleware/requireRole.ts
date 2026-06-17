import { Request, Response, NextFunction } from "express";
import { Role, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

declare global {
  namespace Express {
    interface Request {
      caller?: User;
    }
  }
}

export const requireRole = (...roles: Role[]) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        next(new AppError("Authentication required", 401, "AUTH_REQUIRED"));
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !roles.includes(user.role)) {
        next(new AppError("Forbidden: insufficient permissions", 403, "AUTH_FORBIDDEN"));
        return;
      }

      req.caller = user;
      next();
    } catch (err) {
      next(err);
    }
  };
};
