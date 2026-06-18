/**
 * Environment variable validation and configuration.
 * Validates required environment variables at startup before the server starts.
 */

interface Config {
  port: number;
  nodeEnv: "development" | "production" | "test";
  databaseUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  frontendUrl: string;
  llmApiKey: string;
  storage: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    publicUrl: string;
  };
}

/**
 * Validates that all required environment variables are present.
 * Throws an error with a clear message if any are missing.
 */
const validateConfig = (): void => {
  const requiredVars = [
    "DATABASE_URL",
    "JWT_SECRET",
    "FRONTEND_URL",
    "STORAGE_ENDPOINT",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
    "STORAGE_BUCKET",
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error(
      `\n❌ Missing required environment variables:\n${missingVars.map((v) => `   - ${v}`).join("\n")}\n`
    );
    console.error("Please set these variables before starting the server.\n");
    process.exit(1);
  }
};

/**
 * Loads and returns the application configuration.
 * Validates required environment variables before returning.
 */
export const getConfig = (): Config => {
  validateConfig();

  return {
    port: parseInt(process.env.PORT || "3001", 10),
    nodeEnv: (process.env.NODE_ENV as Config["nodeEnv"]) || "development",
    databaseUrl: process.env.DATABASE_URL!,
    jwtSecret: process.env.JWT_SECRET!,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!,
    frontendUrl: process.env.FRONTEND_URL!,
    llmApiKey: process.env.LLM_API_KEY || "",
    storage: {
      endpoint: process.env.STORAGE_ENDPOINT!,
      accessKey: process.env.STORAGE_ACCESS_KEY!,
      secretKey: process.env.STORAGE_SECRET_KEY!,
      bucket: process.env.STORAGE_BUCKET!,
      publicUrl: (process.env.STORAGE_PUBLIC_URL ?? process.env.STORAGE_ENDPOINT!).replace(/\/$/, ""),
    },
  };
};
