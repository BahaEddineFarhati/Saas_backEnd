import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ChatMessageRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callLLMChat } from "@/lib/llm";
import { buildChatContext } from "@/services/chatContext.service";
import { AppError } from "@/utils/AppError";
import { catchAsync } from "@/utils/catchAsync";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const sendMessageSchema = z.object({
  message: z
    .string()
    .min(1, "message cannot be empty")
    .max(1000, "message cannot exceed 1000 characters"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify that a job opening exists and belongs to the caller's organisation.
 * Throws appropriate AppError if not found or unauthorized.
 */
async function verifyJobOwnership(jobId: string, organisationId: string | null | undefined) {
  const job = await prisma.jobOpening.findUnique({
    where: { id: jobId },
    select: { id: true, organisationId: true },
  });

  if (!job) {
    throw new AppError("Job opening not found", 404, "JOB_NOT_FOUND");
  }

  if (!organisationId || job.organisationId !== organisationId) {
    throw new AppError("You do not have access to this job opening", 403, "FORBIDDEN");
  }

  return job;
}

/**
 * Upsert a chat session for the given user + job pair.
 * Returns the session (always).
 */
async function upsertSession(userId: string, jobOpeningId: string) {
  return prisma.chatSession.upsert({
    where: { userId_jobOpeningId: { userId, jobOpeningId } },
    create: { userId, jobOpeningId },
    update: {},
    select: { id: true },
  });
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/jobs/:jobId/chat/session
 * Create (or return existing) chat session for this user + job combination.
 */
export const createOrGetSession = catchAsync(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { jobId } = req.params;
    const { userId, organisationId } = req.user!;

    await verifyJobOwnership(jobId, organisationId);

    const session = await upsertSession(userId, jobId);
    const messageCount = await prisma.chatMessage.count({
      where: { sessionId: session.id },
    });

    res.status(200).json({ sessionId: session.id, messageCount });
  }
);

/**
 * GET /api/v1/jobs/:jobId/chat/messages
 * Retrieve all messages for this user's session on the given job.
 */
export const getMessages = catchAsync(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { jobId } = req.params;
    const { userId, organisationId } = req.user!;

    await verifyJobOwnership(jobId, organisationId);

    const session = await prisma.chatSession.findUnique({
      where: { userId_jobOpeningId: { userId, jobOpeningId: jobId } },
      select: { id: true },
    });

    if (!session) {
      res.status(200).json({ messages: [] });
      return;
    }

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    res.status(200).json({ messages });
  }
);

/**
 * POST /api/v1/jobs/:jobId/chat/message
 * Send a user message and get an AI response.
 */
export const sendMessage = catchAsync(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { jobId } = req.params;
    const { userId, organisationId } = req.user!;

    // ── Input validation ─────────────────────────────────────────────────────
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message ?? "Invalid request body",
        400,
        "VALIDATION_ERROR"
      );
    }
    const { message } = parsed.data;

    await verifyJobOwnership(jobId, organisationId);

    // ── Upsert session ───────────────────────────────────────────────────────
    const session = await upsertSession(userId, jobId);

    // ── Save user message ────────────────────────────────────────────────────
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatMessageRole.USER,
        content: message,
      },
    });

    // ── Fetch conversation history (last 20 messages) ────────────────────────
    const totalMessages = await prisma.chatMessage.count({
      where: { sessionId: session.id },
    });

    const history = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
      take: Math.min(totalMessages, 20),
      ...(totalMessages > 20 ? { skip: totalMessages - 20 } : {}),
      select: { role: true, content: true },
    });

    // ── Build chat context and call LLM ─────────────────────────────────────
    const systemPrompt = await buildChatContext(jobId);

    const conversationHistory = history.map((m) => ({
      role: m.role === ChatMessageRole.USER ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    const assistantContent = await callLLMChat(systemPrompt, conversationHistory);

    // ── Save assistant response ──────────────────────────────────────────────
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatMessageRole.ASSISTANT,
        content: assistantContent,
      },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    res.status(201).json({ message: assistantMessage });
  }
);

/**
 * DELETE /api/v1/jobs/:jobId/chat/session
 * Clear all messages in this user's session (session row is kept).
 */
export const clearConversation = catchAsync(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { jobId } = req.params;
    const { userId, organisationId } = req.user!;

    await verifyJobOwnership(jobId, organisationId);

    const session = await prisma.chatSession.findUnique({
      where: { userId_jobOpeningId: { userId, jobOpeningId: jobId } },
      select: { id: true },
    });

    if (!session) {
      throw new AppError("Chat session not found", 404, "SESSION_NOT_FOUND");
    }

    await prisma.chatMessage.deleteMany({
      where: { sessionId: session.id },
    });

    res.status(200).json({ message: "Conversation cleared" });
  }
);
