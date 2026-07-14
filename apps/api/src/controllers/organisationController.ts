import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import { prisma } from "@/lib/prisma";
import * as organisationService from "@/services/organisationService";

/**
 * GET /api/v1/organisation
 * Returns the caller's organisation info (name, slug, plan, createdAt).
 */
export const getOrganisation = catchAsync(async (req: Request, res: Response) => {
  const org = await organisationService.getOrganisation(req.user!.organisationId!);

  res.status(200).json({
    success: true,
    data: org,
  });
});

/**
 * PATCH /api/v1/organisation
 * Updates the organisation's name and/or slug.
 */
export const updateOrganisation = catchAsync(async (req: Request, res: Response) => {
  const { name, slug } = req.body;

  if (!name && !slug) {
    res.status(400).json({
      success: false,
      error: {
        message: "At least one of 'name' or 'slug' is required",
        code: "VALIDATION_ERROR",
      },
    });
    return;
  }

  const updated = await organisationService.updateOrganisation(
    req.user!.organisationId!,
    { name, slug }
  );

  res.status(200).json({
    success: true,
    data: updated,
  });
});

/**
 * GET /api/v1/organisation/members
 * Returns all users belonging to the caller's organisation.
 */
export const getMembers = catchAsync(async (req: Request, res: Response) => {
  const members = await organisationService.getMembers(req.user!.organisationId!);

  res.status(200).json({
    success: true,
    data: members,
  });
});

/**
 * PATCH /api/v1/organisation/members/:userId/role
 * Changes a member's role between ADMIN and RECRUITER.
 */
export const updateMemberRole = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { role } = req.body;

  if (!role || !["ADMIN", "RECRUITER"].includes(role)) {
    res.status(400).json({
      success: false,
      error: {
        message: "role must be either 'ADMIN' or 'RECRUITER'",
        code: "VALIDATION_ERROR",
      },
    });
    return;
  }

  const updated = await organisationService.updateMemberRole(
    req.user!.organisationId!,
    userId,
    role
  );

  res.status(200).json({
    success: true,
    data: updated,
  });
});

/**
 * DELETE /api/v1/organisation/members/:userId
 * Deactivates a member's account and revokes their sessions.
 */
export const deactivateMember = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const result = await organisationService.deactivateMember(
    req.user!.organisationId!,
    userId,
    req.user!.userId
  );

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

/**
 * POST /api/v1/organisation/members/invite
 * Sends an invite email to a new team member.
 */
export const inviteMember = catchAsync(async (req: Request, res: Response) => {
  const { email, role } = req.body;

  if (!email) {
    res.status(400).json({
      success: false,
      error: {
        message: "email is required",
        code: "VALIDATION_ERROR",
      },
    });
    return;
  }

  const validRole = role && ["ADMIN", "RECRUITER"].includes(role) ? role : "RECRUITER";

  const invite = await organisationService.createInvite(
    req.user!.organisationId!,
    email,
    validRole,
    req.user!.userId
  );

  res.status(201).json({
    success: true,
    data: invite,
  });
});

/**
 * GET /api/v1/organisation/usage
 * Returns the current month's LLM usage summary for the caller's own organisation.
 * Scoped to the authenticated user's organisationId — no cross-org access.
 */
export const getOwnUsage = catchAsync(async (req: Request, res: Response) => {
  const organisationId = req.user!.organisationId!;
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const summary = await prisma.lLMUsageSummary.findUnique({
    where: {
      organisationId_month_year: { organisationId, month, year },
    },
  });

  res.status(200).json({
    success: true,
    data: {
      summary: summary
        ? {
            month: summary.month,
            year: summary.year,
            totalTokens: summary.totalTokens,
            promptTokens: summary.promptTokens,
            completionTokens: summary.completionTokens,
            cvParsingTokens: summary.cvParsingTokens,
            cvScoringTokens: summary.cvScoringTokens,
            cvEnrichmentTokens: summary.cvEnrichmentTokens,
            chatTokens: summary.chatTokens,
            callCount: summary.callCount,
          }
        : null,
    },
  });
});
