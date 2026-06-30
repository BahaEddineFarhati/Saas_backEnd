import Redis from "ioredis";

/**
 * Singleton Redis client using ioredis.
 * Reuses the same REDIS_URL environment variable already used by BullMQ.
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

redis.connect().catch((err) => {
  console.error("❌ Redis connection failed:", err.message);
});

redis.on("connect", () => {
  console.log("✅ Redis client connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});
