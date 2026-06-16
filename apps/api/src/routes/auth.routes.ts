import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { catchAsync } from "@/utils/catchAsync";
import { AppError } from "@/utils/AppError";
import * as authController from "@/controllers/auth.controller";

const router = Router();

// Zod validation schema matching all criteria
const registerSchema = z.object({
  organisationName: z
    .string({ message: "organisationName is required" })
    .trim()
    .min(1, "organisationName is required"),
  firstName: z
    .string({ message: "firstName is required" })
    .trim()
    .min(1, "firstName is required"),
  lastName: z
    .string({ message: "lastName is required" })
    .trim()
    .min(1, "lastName is required"),
  email: z
    .string({ message: "email is required" })
    .trim()
    .min(1, "email is required")
    .email("email must be a valid email format"),
  password: z
    .string({ message: "password is required" })
    .min(1, "password is required")
    .min(8, "password must be at least 8 characters long")
    .regex(/[A-Z]/, "password must contain at least one uppercase letter")
    .regex(/[0-9]/, "password must contain at least one number"),
});

// Middleware to run Zod validation and convert errors to AppError
const validateRegister = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    const firstError = result.error.issues[0];
    return next(new AppError(firstError.message, 400, "VALIDATION_ERROR"));
  }
  req.body = result.data;
  next();
});

router.post("/register", validateRegister, authController.register);

export default router;
