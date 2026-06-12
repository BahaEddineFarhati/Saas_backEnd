import { PrismaClient } from "@prisma/client";

/**
 * Global singleton PrismaClient instance.
 *
 * In development, attach to global object to prevent multiple instances
 * from being created due to hot-reload. In production, use a single instance.
 */

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
