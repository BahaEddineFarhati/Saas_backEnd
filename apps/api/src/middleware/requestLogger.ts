import morgan from "morgan";
import { Request } from "express";

/**
 * HTTP request logger middleware using Morgan.
 *
 * - Development: Uses 'dev' format for colored, concise logs
 * - Production: Uses 'combined' format for standard Apache logs
 * - Skips logging for GET /health endpoint (health checks)
 */
const requestLogger = morgan(process.env.NODE_ENV === "development" ? "dev" : "combined", {
  skip: (req: Request) => req.method === "GET" && req.path === "/health",
});

export default requestLogger;
