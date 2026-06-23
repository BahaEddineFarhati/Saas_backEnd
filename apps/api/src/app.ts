import express, { Express, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { catchAsync } from "@/utils/catchAsync";
import requestLogger from "@/middleware/requestLogger";
import notFound from "@/middleware/notFound";
import errorHandler from "@/middleware/errorHandler";
import apiRoutes from "@/routes";
import { cvParsingQueue } from "@/lib/queue";
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
 * 6. BullMQ board (development only)
 * 7. API routes
 * 8. 404 handler
 * 9. Global error handler
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

  // BullMQ Board — development only
  if (process.env.NODE_ENV === "development") {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath("/admin/queues");

    createBullBoard({
      queues: [new BullMQAdapter(cvParsingQueue)],
      serverAdapter,
    });

    app.use("/admin/queues", serverAdapter.getRouter());
    console.log("🛠  BullMQ Board → http://localhost:3001/admin/queues");
  }

  // API routes
  app.use("/api/v1", apiRoutes);

  // 404 handler - must come after all route definitions
  app.use(notFound);

  // Global error handler - must be last
  app.use(errorHandler);

  return app;
};