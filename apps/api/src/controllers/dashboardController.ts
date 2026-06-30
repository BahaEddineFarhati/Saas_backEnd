import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import { AppError } from "@/utils/AppError";
import { prisma } from "@/lib/prisma";
import { CandidateStatus, JobStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a continuous date array for a given range (YYYY-MM-DD strings)
// ─────────────────────────────────────────────────────────────────────────────
function buildDateRange(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10)); // "YYYY-MM-DD"
  }
  return dates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: relative timestamp label
// ─────────────────────────────────────────────────────────────────────────────
function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffH < 24) return `il y a ${diffH} heure${diffH > 1 ? "s" : ""}`;
  if (diffD === 1) return "hier";
  if (diffD < 7) return `il y a ${diffD} jours`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/dashboard/stats
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns aggregate counts for the caller's organisation:
 * - activeJobOpenings / totalJobOpenings
 * - totalCandidatesUploaded / candidatesUploadedThisMonth
 * - candidatesPendingParsing / candidatesParsedSuccessfully / candidatesFailedParsing
 * - teamMembersCount
 */
export const getDashboardStats = catchAsync(
  async (req: Request, res: Response) => {
    const organisationId = req.user?.organisationId;
    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    // All job opening IDs for this org (used to scope candidate queries)
    const orgJobIds = await prisma.jobOpening.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const jobIds = orgJobIds.map((j) => j.id);

    // Start of current month (UTC)
    const now = new Date();
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );

    // Run all counts in parallel
    const [
      activeJobOpenings,
      totalJobOpenings,
      totalCandidatesUploaded,
      candidatesUploadedThisMonth,
      candidatesPendingParsing,
      candidatesParsedSuccessfully,
      candidatesFailedParsing,
      teamMembersCount,
    ] = await Promise.all([
      prisma.jobOpening.count({
        where: { organisationId, status: JobStatus.OPEN },
      }),
      prisma.jobOpening.count({
        where: { organisationId },
      }),
      prisma.candidate.count({
        where: { jobOpeningId: { in: jobIds } },
      }),
      prisma.candidate.count({
        where: {
          jobOpeningId: { in: jobIds },
          createdAt: { gte: startOfMonth },
        },
      }),
      prisma.candidate.count({
        where: {
          jobOpeningId: { in: jobIds },
          status: CandidateStatus.PENDING,
        },
      }),
      prisma.candidate.count({
        where: {
          jobOpeningId: { in: jobIds },
          status: CandidateStatus.SCORED,
        },
      }),
      prisma.candidate.count({
        where: {
          jobOpeningId: { in: jobIds },
          status: CandidateStatus.FAILED,
        },
      }),
      prisma.user.count({
        where: { organisationId, isActive: true },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        activeJobOpenings,
        totalJobOpenings,
        totalCandidatesUploaded,
        candidatesUploadedThisMonth,
        candidatesPendingParsing,
        candidatesParsedSuccessfully,
        candidatesFailedParsing,
        teamMembersCount,
      },
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/dashboard/recent-job-openings
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns the 5 most recently updated job openings for the organisation.
 * Each includes: id, title, status, candidateCount, parsedCount.
 * parsedCount = candidates with status SCORED or FAILED (i.e. no longer PENDING).
 */
export const getRecentJobOpenings = catchAsync(
  async (req: Request, res: Response) => {
    const organisationId = req.user?.organisationId;
    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    const jobs = await prisma.jobOpening.findMany({
      where: { organisationId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        _count: {
          select: { candidates: true },
        },
      },
    });

    // Fetch parsed counts for each job in parallel
    const jobIds = jobs.map((j) => j.id);
    const parsedCounts = await prisma.candidate.groupBy({
      by: ["jobOpeningId"],
      where: {
        jobOpeningId: { in: jobIds },
        status: { in: [CandidateStatus.SCORED, CandidateStatus.FAILED] },
      },
      _count: { id: true },
    });

    const parsedByJob = new Map(
      parsedCounts.map((r) => [r.jobOpeningId, r._count.id])
    );

    const data = jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      candidateCount: j._count.candidates,
      parsedCount: parsedByJob.get(j.id) ?? 0,
      updatedAt: j.updatedAt,
    }));

    res.status(200).json({ success: true, data });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/dashboard/recent-activity
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns the 10 most recent events for the organisation, derived from
 * existing table timestamps — no event log table required.
 *
 * Event types:
 *   job_created  — JobOpening created (createdAt)
 *   cvs_uploaded — batch of candidates uploaded on a given day for a job
 *   job_closed   — JobOpening closed (status=CLOSED, ordered by updatedAt)
 *
 * Each event: { type, message, jobOpeningId, jobOpeningTitle, timestamp }
 */
export const getRecentActivity = catchAsync(
  async (req: Request, res: Response) => {
    const organisationId = req.user?.organisationId;
    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    // Fetch all job openings for the org (needed for all event types)
    const jobs = await prisma.jobOpening.findMany({
      where: { organisationId },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50, // limit scope
    });

    const jobIds = jobs.map((j) => j.id);
    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    type ActivityEvent = {
      type: "job_created" | "cvs_uploaded" | "job_closed";
      message: string;
      jobOpeningId: string;
      jobOpeningTitle: string;
      timestamp: Date;
    };

    const events: ActivityEvent[] = [];

    // ── Event 1: job created ──────────────────────────────────────────────
    for (const job of jobs) {
      events.push({
        type: "job_created",
        message: `Offre « ${job.title} » créée`,
        jobOpeningId: job.id,
        jobOpeningTitle: job.title,
        timestamp: job.createdAt,
      });
    }

    // ── Event 2: job closed ───────────────────────────────────────────────
    for (const job of jobs) {
      if (job.status === JobStatus.CLOSED) {
        // updatedAt is the last modification — when closed it was updated
        events.push({
          type: "job_closed",
          message: `Offre « ${job.title} » clôturée`,
          jobOpeningId: job.id,
          jobOpeningTitle: job.title,
          timestamp: job.updatedAt,
        });
      }
    }

    // ── Event 3: CV batch upload — one event per (job, day) ──────────────
    // Use raw SQL to group candidates by jobOpeningId + date
    if (jobIds.length > 0) {
      const rows = await prisma.$queryRaw<
        { job_opening_id: string; upload_date: Date; cnt: bigint }[]
      >`
        SELECT
          "jobOpeningId"   AS job_opening_id,
          DATE("createdAt") AS upload_date,
          COUNT(*)          AS cnt
        FROM candidates
        WHERE "jobOpeningId" = ANY(${jobIds})
        GROUP BY "jobOpeningId", DATE("createdAt")
        ORDER BY upload_date DESC
        LIMIT 30
      `;

      for (const row of rows) {
        const job = jobMap.get(row.job_opening_id);
        if (!job) continue;
        const count = Number(row.cnt);
        events.push({
          type: "cvs_uploaded",
          message: `${count} CV${count > 1 ? "s" : ""} téléversé${count > 1 ? "s" : ""} pour « ${job.title} »`,
          jobOpeningId: job.id,
          jobOpeningTitle: job.title,
          timestamp: new Date(row.upload_date),
        });
      }
    }

    // Sort all events by timestamp descending and take top 10
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const top10 = events.slice(0, 10);

    const data = top10.map((e) => ({
      type: e.type,
      message: e.message,
      jobOpeningId: e.jobOpeningId,
      jobOpeningTitle: e.jobOpeningTitle,
      timestamp: e.timestamp.toISOString(),
      timeAgo: relativeTime(e.timestamp),
    }));

    res.status(200).json({ success: true, data });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/dashboard/charts/candidates-over-time
// Query param: range = "7d" | "30d" | "90d" (default "30d")
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns a continuous daily time series of CVs uploaded for the given range.
 * Days with zero uploads are included with count: 0.
 * { data: [{ date: "2026-06-01", count: 12 }, ...] }
 */
export const getCandidatesOverTime = catchAsync(
  async (req: Request, res: Response) => {
    const organisationId = req.user?.organisationId;
    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    // Parse range
    const rangeParam = (req.query.range as string) || "30d";
    const rangeMap: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
    const days = rangeMap[rangeParam];
    if (!days) {
      throw new AppError(
        "range must be 7d, 30d, or 90d",
        400,
        "VALIDATION_ERROR"
      );
    }

    // Get all job opening IDs for this org
    const orgJobIds = await prisma.jobOpening.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const jobIds = orgJobIds.map((j) => j.id);

    if (jobIds.length === 0) {
      // No jobs → all zero
      const dates = buildDateRange(days);
      res.status(200).json({
        success: true,
        data: dates.map((date) => ({ date, count: 0 })),
      });
      return;
    }

    // Compute start date
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    // Raw SQL: group candidates by creation date within range
    const rows = await prisma.$queryRaw<
      { day: Date; cnt: bigint }[]
    >`
      SELECT
        DATE("createdAt") AS day,
        COUNT(*)          AS cnt
      FROM candidates
      WHERE
        "jobOpeningId" = ANY(${jobIds})
        AND "createdAt" >= ${startDate}
      GROUP BY DATE("createdAt")
      ORDER BY day ASC
    `;

    // Build a lookup map: "YYYY-MM-DD" → count
    const countByDate = new Map<string, number>();
    for (const row of rows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      countByDate.set(key, Number(row.cnt));
    }

    // Fill every day in the range, including zeros
    const allDates = buildDateRange(days);
    const data = allDates.map((date) => ({
      date,
      count: countByDate.get(date) ?? 0,
    }));

    res.status(200).json({ success: true, data });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/dashboard/charts/parsing-status
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns candidate counts grouped by parsing status across all org job openings.
 * { data: [{ status: "PENDING", count: 12 }, { status: "SCORED", count: 230 }, ...] }
 */
export const getParsingStatus = catchAsync(
  async (req: Request, res: Response) => {
    const organisationId = req.user?.organisationId;
    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    const orgJobIds = await prisma.jobOpening.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const jobIds = orgJobIds.map((j) => j.id);

    if (jobIds.length === 0) {
      res.status(200).json({
        success: true,
        data: [
          { status: "PENDING", count: 0 },
          { status: "SCORED", count: 0 },
          { status: "FAILED", count: 0 },
        ],
      });
      return;
    }

    const grouped = await prisma.candidate.groupBy({
      by: ["status"],
      where: {
        jobOpeningId: { in: jobIds },
        // Only report the three statuses meaningful for parsing
        status: {
          in: [
            CandidateStatus.PENDING,
            CandidateStatus.SCORED,
            CandidateStatus.FAILED,
          ],
        },
      },
      _count: { id: true },
    });

    // Ensure all three statuses are always present
    const statusMap = new Map(grouped.map((r) => [r.status, r._count.id]));
    const data = [
      CandidateStatus.PENDING,
      CandidateStatus.SCORED,
      CandidateStatus.FAILED,
    ].map((s) => ({ status: s, count: statusMap.get(s) ?? 0 }));

    res.status(200).json({ success: true, data });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/dashboard/charts/openings-funnel
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns a simplified hiring funnel based on what currently exists:
 * - Offres ouvertes        → open job openings
 * - Offres fermées         → closed job openings
 * - Candidatures reçues   → total candidates
 * - Candidatures analysées → candidates with status SCORED or FAILED
 *
 * { data: [{ stage: "Offres ouvertes", count: 6 }, ...] }
 */
export const getOpeningsFunnel = catchAsync(
  async (req: Request, res: Response) => {
    const organisationId = req.user?.organisationId;
    if (!organisationId) {
      throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
    }

    const orgJobIds = await prisma.jobOpening.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const jobIds = orgJobIds.map((j) => j.id);

    const [openCount, closedCount, totalCandidates, parsedCandidates] =
      await Promise.all([
        prisma.jobOpening.count({
          where: { organisationId, status: JobStatus.OPEN },
        }),
        prisma.jobOpening.count({
          where: { organisationId, status: JobStatus.CLOSED },
        }),
        jobIds.length > 0
          ? prisma.candidate.count({
              where: { jobOpeningId: { in: jobIds } },
            })
          : Promise.resolve(0),
        jobIds.length > 0
          ? prisma.candidate.count({
              where: {
                jobOpeningId: { in: jobIds },
                status: {
                  in: [CandidateStatus.SCORED, CandidateStatus.FAILED],
                },
              },
            })
          : Promise.resolve(0),
      ]);

    const data = [
      { stage: "Offres ouvertes", count: openCount },
      { stage: "Offres fermées", count: closedCount },
      { stage: "Candidatures reçues", count: totalCandidates },
      { stage: "Candidatures analysées", count: parsedCandidates },
    ];

    res.status(200).json({ success: true, data });
  }
);
