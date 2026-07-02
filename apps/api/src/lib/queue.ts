import { Queue, QueueEvents } from "bullmq";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const url = new URL(REDIS_URL);

export const redisConnection = {
  host: url.hostname,
  port: Number(url.port) || 6379,
};

export const CV_PARSING_QUEUE = "cv-parsing";

export const cvParsingQueue = new Queue(CV_PARSING_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

export const cvParsingQueueEvents = new QueueEvents(CV_PARSING_QUEUE, {
  connection: redisConnection,
});

export const CV_SCORING_QUEUE = "cv-scoring";

export const cvScoringQueue = new Queue(CV_SCORING_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

export const cvScoringQueueEvents = new QueueEvents(CV_SCORING_QUEUE, {
  connection: redisConnection,
});

console.log(`✅ Redis queue configured at ${url.hostname}:${url.port || 6379}`);
