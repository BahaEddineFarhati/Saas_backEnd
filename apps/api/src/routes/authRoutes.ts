import { NextFunction, Router, Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import {
  register,
  loginController,
  logoutController,
  refreshTokenController,
} from "@/controllers/authController";
import zod from "zod";
import { AppError } from "@/utils/AppError";

const router = Router();

// Zod validation schema matching all criteria
const registerSchema = zod.object({
  organisationName: zod
    .string({ message: "organisationName is required" })
    .trim()
    .min(1, "organisationName is required"),
  firstName: zod
    .string({ message: "firstName is required" })
    .trim()
    .min(1, "firstName is required"),
  lastName: zod
    .string({ message: "lastName is required" })
    .trim()
    .min(1, "lastName is required"),
  email: zod
    .string({ message: "email is required" })
    .trim()
    .min(1, "email is required")
    .email("email must be a valid email format"),
  password: zod
    .string({ message: "password is required" })
    .min(1, "password is required")
    .min(8, "password must be at least 8 characters long")
    .regex(/[A-Z]/, "password must contain at least one uppercase letter")
    .regex(/[0-9]/, "password must contain at least one number"),
});

// Middleware to run Zod validation and convert errors to AppError
const validateRegister = (req: Request, _res: Response, next: NextFunction) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    const firstError = result.error.issues[0];
    return next(new AppError(firstError.message, 400, "VALIDATION_ERROR"));
  }
  (req as any).validatedData = result.data;
  next();
};

router.post("/register", validateRegister, register);

/**
 * POST /api/v1/auth/login
 * Login with email and password
 * Returns access token and refresh token
 */
router.post("/login", catchAsync(loginController));

/**
 * POST /api/v1/auth/logout
 * Logout by invalidating refresh token
 */
router.post("/logout", catchAsync(logoutController));

/**
 * POST /api/v1/auth/refresh
 * Refresh access token using refresh token
 */
router.post("/refresh", catchAsync(refreshTokenController));

export default router;
