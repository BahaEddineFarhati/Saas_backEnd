import { Queue, QueueEvents } from "bullmq";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Parse the URL into host/port for BullMQ's built-in ioredis
const url = new URL(REDIS_URL);

const connection = {
  host: url.hostname,
  port: Number(url.port) || 6379,
};

export const queue = new Queue("main", {
  connection,
});

export const queueEvents = new QueueEvents("main", {
  connection,
});

console.log(`✅ Redis queue configured at ${url.hostname}:${url.port || 6379}`);