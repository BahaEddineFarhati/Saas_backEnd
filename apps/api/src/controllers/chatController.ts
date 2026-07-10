import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ChatMessageRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callLLM } from "@/lib/llm";
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

    // Append suggestion instruction so the LLM returns follow-up questions
    const suggestionsInstruction =
      '\n\nAfter your response, on the very last line, output exactly: SUGGESTIONS:["question 1","question 2"]\n' +
      "These should be 2 short follow-up questions (under 60 characters each) the recruiter might want to ask YOU (the AI assistant) next about the candidates. " +
      "Write them in the third person, asking about the candidates (e.g., 'Quel est le score de Marie ?' or 'Quelle est l'expérience de Jean ?' " +
      "instead of direct interview questions like 'Quelle est votre expérience ?'). " +
      "Do not include this line in your main response text. " +
      "IMPORTANT: You MUST respond in the exact same language as the user's prompt (if the user writes in French, respond in French).";

    const conversationHistory = history.map((m, idx) => {
      let content = m.content;
      // Reinforce the instruction by appending it to the very last user message in the context
      if (idx === history.length - 1 && m.role === ChatMessageRole.USER) {
        content +=
          "\n\n(Remember: You MUST respond in the same language as my prompt (French). At the end of your response, you MUST provide 2 short follow-up questions for the recruiter to ask YOU about the candidates. " +
          "Write them in the third person asking about candidates. " +
          'Output them exactly in this format on the last line: SUGGESTIONS:["question 1","question 2"] or list them as bullets starting with SUGGESTIONS:)';
      }
      return {
        role: m.role === ChatMessageRole.USER ? ("user" as const) : ("assistant" as const),
        content,
      };
    });

    const assistantContent = await callLLM("", systemPrompt + suggestionsInstruction, {
      messages: conversationHistory,
      temperature: 0.3,
    });

    // ── Parse suggestions from the LLM response (robust hybrid parser) ──────
    let cleanContent = assistantContent;
    let suggestions: string[] | undefined;

    const matchIndex = assistantContent.search(/SUGGESTIONS:/i);
    if (matchIndex !== -1) {
      const mainResponse = assistantContent.slice(0, matchIndex).trim();
      const suggestionsSection = assistantContent.slice(matchIndex + "SUGGESTIONS:".length).trim();

      // Check if it's a JSON array
      if (suggestionsSection.startsWith("[")) {
        try {
          const parsed = JSON.parse(suggestionsSection);
          if (Array.isArray(parsed) && parsed.every((s: unknown) => typeof s === "string")) {
            suggestions = parsed.slice(0, 2);
          }
        } catch {
          // Fall back to line parsing
        }
      }

      // If not parsed as JSON, parse it as a markdown bulleted or numbered list
      if (!suggestions) {
        const lines = suggestionsSection.split("\n");
        const listItems: string[] = [];
        for (const line of lines) {
          const cleanLine = line.replace(/^\s*[-*•]\s*|^\s*\d+\.\s*/, "").trim();
          if (cleanLine) {
            listItems.push(cleanLine);
          }
        }
        if (listItems.length > 0) {
          suggestions = listItems.slice(0, 2);
        }
      }

      cleanContent = mainResponse;
    }

    // ── Save assistant response ──────────────────────────────────────────────
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatMessageRole.ASSISTANT,
        content: cleanContent,
      },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    res.status(201).json({ message: assistantMessage, suggestions });
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
