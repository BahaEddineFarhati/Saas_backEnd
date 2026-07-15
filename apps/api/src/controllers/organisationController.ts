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

/**
 * GET /api/v1/organisation/usage/history
 * Returns 12 months of monthly summary history, chronologically ordered, for the caller's own organisation.
 */
export const getOwnUsageHistory = catchAsync(async (req: Request, res: Response) => {
  const organisationId = req.user!.organisationId!;

  // Fetch the organisation details
  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { id: true, name: true, slug: true },
  });

  if (!organisation) {
    throw new AppError("Organisation not found", 404, "NOT_FOUND");
  }

  // Calculate the date 12 months ago
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Fetch all summaries for this org, ordered chronologically, limited to 12
  const summaries = await prisma.lLMUsageSummary.findMany({
    where: { organisationId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 12,
    select: {
      month: true,
      year: true,
      totalTokens: true,
      cvParsingTokens: true,
      cvScoringTokens: true,
      cvEnrichmentTokens: true,
      chatTokens: true,
      callCount: true,
    },
  });

  // Reverse to chronological order (oldest first)
  summaries.reverse();

  // Build full 12-month timeline with zeros for missing months
  const history: Array<{
    month: number;
    year: number;
    totalTokens: number;
    cvParsingTokens: number;
    cvScoringTokens: number;
    cvEnrichmentTokens: number;
    chatTokens: number;
    callCount: number;
  }> = [];
  for (let i = 11; i >= 0; i--) {
    let m = currentMonth - i;
    let y = currentYear;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }

    const existing = summaries.find((s) => s.month === m && s.year === y);
    history.push({
      month: m,
      year: y,
      totalTokens: existing?.totalTokens ?? 0,
      cvParsingTokens: existing?.cvParsingTokens ?? 0,
      cvScoringTokens: existing?.cvScoringTokens ?? 0,
      cvEnrichmentTokens: existing?.cvEnrichmentTokens ?? 0,
      chatTokens: existing?.chatTokens ?? 0,
      callCount: existing?.callCount ?? 0,
    });
  }

  res.status(200).json({
    success: true,
    data: {
      organisation,
      history,
    },
  });
});

