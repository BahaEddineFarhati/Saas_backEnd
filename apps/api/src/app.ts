import express, { Express, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import { catchAsync } from "@/utils/catchAsync";
import requestLogger from "@/middleware/requestLogger";
import notFound from "@/middleware/notFound";
import errorHandler from "@/middleware/errorHandler";
import apiRoutes from "@/routes";
import type { HealthCheckResponse } from "@/types";

/**
 * Creates and configures the Express application.
 *
 * Registers middleware and routes in the correct order:
 * 1. Security middleware (helmet)
 * 2. CORS configuration
 * 3. Body parsing middleware
 * 4. Request logging
 * 5. Health check endpoint
 * 6. API routes
 * 7. 404 handler
 * 8. Global error handler
 */
export const createApp = (): Express => {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS - accepts only from configured frontend origin
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  app.use(
    cors({
      origin: frontendUrl,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Body parsing
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // Request logging
  app.use(requestLogger);

  /**
   * Health check endpoint
   * Returns 200 with status, timestamp, and environment
   * Accessible without authentication
   */
  app.get(
    "/health",
    catchAsync((_req, res: Response<HealthCheckResponse>) => {
      res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
      });
    })
  );

  // API routes
  app.use("/api/v1", apiRoutes);

  // 404 handler - must come after all route definitions
  app.use(notFound);

  // Global error handler - must be last
  app.use(errorHandler);

  return app;
};
