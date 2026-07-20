import { Request, Response, NextFunction } from "express";
import { prisma } from "@/lib/prisma";
import { catchAsync } from "@/utils/catchAsync";
import { AppError } from "@/utils/AppError";

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseIntParam(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// ── Controllers ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/usage
 * Paginated list of monthly usage summaries across all organisations.
 * Query: month, year, organisationId, page, limit
 */
export const getUsageSummaries = catchAsync(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const page = parseIntParam(req.query.page, 1);
    const limit = parseIntParam(req.query.limit, 20);
    const skip = (page - 1) * limit;

    const now = new Date();
    const year = parseIntParam(req.query.year, now.getFullYear());

    // Build where clause
    const where: Record<string, unknown> = { year };

    if (req.query.month) {
      const month = parseIntParam(req.query.month, 0);
      if (month >= 1 && month <= 12) {
        where.month = month;
      }
    }

    if (req.query.organisationId && typeof req.query.organisationId === "string") {
      where.organisationId = req.query.organisationId;
    }

    const [data, total] = await Promise.all([
      prisma.lLMUsageSummary.findMany({
        where,
        include: {
          organisation: {
            select: { id: true, name: true, slug: true },
          },
        },
        orderBy: { totalTokens: "desc" },
        skip,
        take: limit,
      }),
      prisma.lLMUsageSummary.count({ where }),
    ]);

    res.status(200).json({
      data: data.map((row) => ({
        organisation: row.organisation,
        month: row.month,
        year: row.year,
        totalTokens: row.totalTokens,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        cvParsingTokens: row.cvParsingTokens,
        cvScoringTokens: row.cvScoringTokens,
        cvEnrichmentTokens: row.cvEnrichmentTokens,
        chatTokens: row.chatTokens,
        callCount: row.callCount,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
);

/**
 * GET /api/v1/admin/usage/:organisationId/:year/:month
 * Detailed usage breakdown for a specific org + month.
 */
export const getUsageDetail = catchAsync(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { organisationId } = req.params;
    const year = parseIntParam(req.params.year, 0);
    const month = parseIntParam(req.params.month, 0);

    if (!year || month < 1 || month > 12) {
      throw new AppError("Invalid year or month", 400, "VALIDATION_ERROR");
    }

    // Verify organisation exists
    const organisation = await prisma.organisation.findUnique({
      where: { id: organisationId },
      select: { id: true, name: true, slug: true },
    });

    if (!organisation) {
      throw new AppError("Organisation not found", 404, "NOT_FOUND");
    }

    const [summary, topLogs] = await Promise.all([
      prisma.lLMUsageSummary.findUnique({
        where: {
          organisationId_month_year: { organisationId, month, year },
        },
      }),
      prisma.lLMUsageLog.findMany({
        where: { organisationId, month, year },
        orderBy: { totalTokens: "desc" },
        take: 10,
        select: {
          id: true,
          feature: true,
          provider: true,
          model: true,
          totalTokens: true,
          promptTokens: true,
          completionTokens: true,
          createdAt: true,
        },
      }),
    ]);

    res.status(200).json({
      organisation,
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
      topLogs,
    });
  }
);

/**
 * GET /api/v1/admin/usage/:organisationId/history
 * 12 months of monthly summary history, chronologically ordered.
 */
export const getUsageHistory = catchAsync(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { organisationId } = req.params;

    // Verify organisation exists
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

    res.status(200).json({ organisation, history });
  }
);

/**
 * GET /api/v1/admin/usage/platform-totals
 * Platform-wide aggregated token usage for current and previous month.
 */
export const getPlatformTotals = catchAsync(
  async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Calculate previous month
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }

    const [currentAgg, previousAgg] = await Promise.all([
      prisma.lLMUsageSummary.aggregate({
        where: { month: currentMonth, year: currentYear },
        _sum: {
          totalTokens: true,
          promptTokens: true,
          completionTokens: true,
          cvParsingTokens: true,
          cvScoringTokens: true,
          cvEnrichmentTokens: true,
          chatTokens: true,
          callCount: true,
        },
      }),
      prisma.lLMUsageSummary.aggregate({
        where: { month: prevMonth, year: prevYear },
        _sum: {
          totalTokens: true,
          promptTokens: true,
          completionTokens: true,
          cvParsingTokens: true,
          cvScoringTokens: true,
          cvEnrichmentTokens: true,
          chatTokens: true,
          callCount: true,
        },
      }),
    ]);

    const formatAgg = (agg: typeof currentAgg) => ({
      totalTokens: agg._sum.totalTokens ?? 0,
      promptTokens: agg._sum.promptTokens ?? 0,
      completionTokens: agg._sum.completionTokens ?? 0,
      cvParsingTokens: agg._sum.cvParsingTokens ?? 0,
      cvScoringTokens: agg._sum.cvScoringTokens ?? 0,
      cvEnrichmentTokens: agg._sum.cvEnrichmentTokens ?? 0,
      chatTokens: agg._sum.chatTokens ?? 0,
      callCount: agg._sum.callCount ?? 0,
    });

    res.status(200).json({
      currentMonth: {
        month: currentMonth,
        year: currentYear,
        ...formatAgg(currentAgg),
      },
      previousMonth: {
        month: prevMonth,
        year: prevYear,
        ...formatAgg(previousAgg),
      },
    });
  }
);
