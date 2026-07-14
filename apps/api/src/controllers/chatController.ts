import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ChatMessageRole, LLMFeature } from "@prisma/client";
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

    // ── Greeting / Small Talk short-circuit (V3) ──────────────────────────────
    // Detect generic greetings and small talk (e.g., "bnj", "ça va", "merci")
    // to respond with a canned message directly, avoiding the LLM prompt bypass.
    const GREETINGS_FR = new Set(["salut", "bonjour", "bonsoir", "coucou", "bnj", "slt", "cc"]);
    const GREETINGS_ALL = new Set([
      "hi", "hello", "hey", "yo", "sup", "hola", "hi there", "hello there",
      ...GREETINGS_FR
    ]);

    const normalizedMessage = message.trim().toLowerCase().replace(/[^a-zA-ZÀ-ÿ\s]/g, "").trim();
    const words = normalizedMessage.split(/\s+/).filter(Boolean);

    let isGreeting = false;

    if (normalizedMessage === "" || GREETINGS_ALL.has(normalizedMessage)) {
      isGreeting = true;
    } else if (words.length > 0 && words.length <= 3 && !message.includes("?")) {
      // Fallback rule for generic/small talk
      // Get all candidate names for this job opening to avoid intercepting a candidate query
      const candidates = await prisma.candidate.findMany({
        where: { jobOpeningId: jobId },
        select: { firstName: true, lastName: true },
      });

      const restrictedKeywords = new Set([
        "candidat", "candidate", "score", "poste", "job", "docker", "kubernetes",
        "compétence", "skill", "shortlist", "recommand", "cv"
      ]);

      const containsRestricted = words.some(word => {
        if (restrictedKeywords.has(word)) return true;
        // Check candidate names
        return candidates.some(c => {
          const fn = c.firstName?.toLowerCase();
          const ln = c.lastName?.toLowerCase();
          return (fn && fn === word) || (ln && ln === word);
        });
      });

      if (!containsRestricted) {
        isGreeting = true;
      }
    }

    if (isGreeting) {
      // Simple heuristic for language detection: check for French greeting words, accents, or common French words
      const hasFrenchAccents = /[éèêëàâäôöûüçïîÿ]/i.test(message);
      const frenchCommonWords = new Set([
        "comment", "vous", "allez", "ça", "ca", "va", "merci", "bonjour", "salut",
        "svp", "oui", "non", "peux", "pouvez", "es", "êtes", "etes", "bonsoir",
        "coucou", "bnj", "slt", "cc"
      ]);
      const hasFrenchWord = words.some(word => frenchCommonWords.has(word));

      const isFrench =
        normalizedMessage === "" ||
        hasFrenchAccents ||
        hasFrenchWord;

      const cannedResponse = isFrench
        ? "Bonjour ! Je suis l'assistant de recrutement pour ce poste. Posez-moi une question sur les candidats ou les résultats."
        : "Hi! I'm the recruitment assistant for this job opening. Ask me anything about the candidates or results.";

      const assistantMessage = await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: ChatMessageRole.ASSISTANT,
          content: cannedResponse,
        },
        select: { id: true, role: true, content: true, createdAt: true },
      });

      res.status(201).json({ message: assistantMessage });
      return;
    }

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
      "\n\n" +
      "IMPORTANT: You MUST respond in the exact same language as the user (e.g., if the user writes in French, respond in French; if they write in English, respond in English).\n" +
      "After your answer, add exactly one line with no other text on it, in this EXACT format (a JSON array of exactly 2 FULL QUESTIONS, double-quoted, third-person, under 60 characters each, same language as your answer):\n" +
      "SUGGESTIONS:[\"...\",\"...\"]\n" +
      "Example of a CORRECT suggestions line: SUGGESTIONS:[\"What is [Candidate]'s level in [skill]?\",\"Does [Candidate] have experience with [technology]?\"]\n" +
      "Example of an INCORRECT suggestions line (DO NOT do this — names alone are not questions): SUGGESTIONS:[\"[Candidate Name]\",\"[Another Candidate]\"]\n" +
      "Each suggestion MUST be a complete, grammatically valid question ending in a question mark.\n" +
      "Do not write anything after that line. Do not ask the user questions directly in your main answer — any follow-up questions belong ONLY inside the SUGGESTIONS line.";

    const conversationHistory = history.map((m) => {
      return {
        role: m.role === ChatMessageRole.USER ? ("user" as const) : ("assistant" as const),
        content: m.content,
      };
    });

    const assistantContent = await callLLM("", systemPrompt + suggestionsInstruction, {
      messages: conversationHistory,
      temperature: 0.3,
    },
    LLMFeature.CHAT,
    organisationId ? { organisationId, userId } : undefined
    );

    // ── Parse suggestions from the LLM response (robust hybrid parser) ──────
    let cleanContent = assistantContent;
    let suggestions: string[] | undefined;

    const isValidSuggestion = (s: string) => {
      const trimmed = s.trim();
      return trimmed.endsWith("?") && trimmed.split(/\s+/).filter(Boolean).length >= 4;
    };

    const matchIndex = assistantContent.search(/SUGGESTIONS:/i);
    if (matchIndex !== -1) {
      const mainResponse = assistantContent.slice(0, matchIndex).trim();
      const suggestionsSection = assistantContent.slice(matchIndex + "SUGGESTIONS:".length).trim();

      // Check if it's a JSON array
      if (suggestionsSection.startsWith("[")) {
        try {
          const parsed = JSON.parse(suggestionsSection);
          if (Array.isArray(parsed) && parsed.every((s: unknown) => typeof s === "string")) {
            const valid = (parsed as string[]).filter(isValidSuggestion);
            if (valid.length >= 2) {
              suggestions = valid.slice(0, 2);
            }
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
        const valid = listItems.filter(isValidSuggestion);
        if (valid.length >= 2) {
          suggestions = valid.slice(0, 2);
        }
      }

      cleanContent = mainResponse;
    }

    // ── Always strip leaked trailing questions from cleanContent ─────────────
    // The LLM sometimes writes recruiter-directed questions in the main answer
    // body (before or without the SUGGESTIONS marker). Detect and remove them.
    {
      const parts = cleanContent.split(/\n\n/);
      if (parts.length >= 2) {
        const trailingSegments: string[] = [];
        for (let i = parts.length - 1; i >= Math.max(0, parts.length - 2); i--) {
          const segment = parts[i].trim();
          const segmentLines = segment.split(/\n/).map((l: string) => l.trim()).filter(Boolean);
          const allQuestions = segmentLines.length > 0 && segmentLines.every((l: string) => l.endsWith("?"));
          if (allQuestions && segmentLines.length <= 2) {
            trailingSegments.unshift(String(i));
          } else {
            break;
          }
        }

        if (trailingSegments.length > 0) {
          const firstTrailingIdx = Number(trailingSegments[0]);
          cleanContent = parts.slice(0, firstTrailingIdx).join("\n\n").trim();
          console.warn("applied fallback trim on trailing question-like lines");
        }
      }
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
