import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import * as authService from "@/services/auth.service";

export const register = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.register(req.body);
  
  // Return exactly the specified response structure
  res.status(201).json(result);
});
