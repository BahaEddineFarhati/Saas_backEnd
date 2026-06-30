import "dotenv/config";

import { createApp } from "@/app";
import { getConfig } from "@/config";
import { startCvParsingWorker } from "@/workers/cvParser.worker";
import { startCvScoringWorker } from "@/workers/cvScorer.worker";

/**
 * Entry point for the application.
 * Loads configuration, creates the Express app, and starts the server.
 * Handles uncaught exceptions and unhandled rejections.
 */

const main = async (): Promise<void> => {
  try {
    // Load and validate configuration
    const config = getConfig();

    // Create Express app
    const app = createApp();

    // Start the CV parsing worker
    startCvParsingWorker();

    // Start the CV scoring worker
    startCvScoringWorker();

    // Start the server
    app.listen(config.port, () => {
      console.log(
        `\n✅ Server running on port ${config.port} (${config.nodeEnv})\n`
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on("uncaughtException", (error: Error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason: unknown) => {
  console.error("❌ Unhandled Rejection:", reason);
  process.exit(1);
});

// Start the application
main();
