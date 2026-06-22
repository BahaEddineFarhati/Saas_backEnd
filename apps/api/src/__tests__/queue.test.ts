jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({ name })),
  QueueEvents: jest.fn().mockImplementation((name: string) => ({ name })),
}));

describe("queue configuration", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  it("creates the queue with name cv-parsing", async () => {
    const { cvParsingQueue } = await import("@/lib/queue");
    expect(cvParsingQueue.name).toBe("cv-parsing");
  });

  it("exports a redisConnection object with host and port", async () => {
    const { redisConnection } = await import("@/lib/queue");
    expect(redisConnection).toMatchObject({ host: "localhost", port: 6379 });
  });

  it("parses custom REDIS_URL correctly", async () => {
    process.env.REDIS_URL = "redis://redis-host:6380";
    jest.resetModules();
    const { redisConnection } = await import("@/lib/queue");
    expect(redisConnection).toMatchObject({ host: "redis-host", port: 6380 });
  });

  it("exports CV_PARSING_QUEUE constant", async () => {
    const { CV_PARSING_QUEUE } = await import("@/lib/queue");
    expect(CV_PARSING_QUEUE).toBe("cv-parsing");
  });
});
