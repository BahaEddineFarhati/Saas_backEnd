import { Router } from "express";
import { verifyAuthToken } from "@/middleware/authMiddleware";
import { blockSuperAdmin } from "@/middleware/blockSuperAdmin";
import {
  createOrGetSession,
  getMessages,
  sendMessage,
  clearConversation,
} from "@/controllers/chatController";

/**
 * Chat sub-router — mounted at /:jobId/chat in jobRoutes.ts
 * mergeParams: true allows access to :jobId from the parent router
 */
const router = Router({ mergeParams: true });

/**
 * POST /api/v1/jobs/:jobId/chat/session
 * Create or retrieve an existing chat session for this user + job
 */
router.post("/session", verifyAuthToken, blockSuperAdmin, createOrGetSession);

/**
 * GET /api/v1/jobs/:jobId/chat/messages
 * Get all messages for this user's chat session on the given job
 */
router.get("/messages", verifyAuthToken, blockSuperAdmin, getMessages);

/**
 * POST /api/v1/jobs/:jobId/chat/message
 * Send a user message and receive an AI response
 */
router.post("/message", verifyAuthToken, blockSuperAdmin, sendMessage);

/**
 * DELETE /api/v1/jobs/:jobId/chat/session
 * Clear all messages in the session (session row is preserved)
 */
router.delete("/session", verifyAuthToken, blockSuperAdmin, clearConversation);

export default router;
