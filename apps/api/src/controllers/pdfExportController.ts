import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { catchAsync } from "@/utils/catchAsync";
import { AppError } from "@/utils/AppError";
import { prisma } from "@/lib/prisma";

/**
 * Structure of `scoreExplanation` JSON stored by the scoring worker.
 * See: src/workers/cvScorer.worker.ts → ScoringResult interface
 */
interface ScoreExplanation {
  score: number;
  matchedCriteria: string[];
  missingCriteria: string[];
  strengths: string[];
  verdict: "STRONG_FIT" | "GOOD_FIT" | "PARTIAL_FIT" | "WEAK_FIT";
}

// ── PDF layout constants ───────────────────────────────────────
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const FOOTER_Y = PAGE_HEIGHT - 40;

// Table column positions (x offsets from left margin)
const COL_RANK_X = MARGIN;
const COL_RANK_W = 40;
const COL_NAME_X = COL_RANK_X + COL_RANK_W;
const COL_NAME_W = 140;
const COL_SCORE_X = COL_NAME_X + COL_NAME_W;
const COL_SCORE_W = 55;
const COL_RECAP_X = COL_SCORE_X + COL_SCORE_W;
const COL_RECAP_W = CONTENT_WIDTH - COL_RANK_W - COL_NAME_W - COL_SCORE_W;

const ROW_MIN_HEIGHT = 30;

/**
 * Extract a readable recap paragraph from the scoreExplanation JSON.
 * Builds a concise paragraph from strengths, matched & missing criteria.
 */
function buildRecapText(explanation: unknown): string {
  if (!explanation || typeof explanation !== "object") {
    return "Aucune explication disponible.";
  }

  const exp = explanation as Partial<ScoreExplanation>;
  const parts: string[] = [];

  if (Array.isArray(exp.strengths) && exp.strengths.length > 0) {
    parts.push(`Points forts : ${exp.strengths.join(", ")}.`);
  }
  if (Array.isArray(exp.matchedCriteria) && exp.matchedCriteria.length > 0) {
    parts.push(`Critères remplis : ${exp.matchedCriteria.join(", ")}.`);
  }
  if (Array.isArray(exp.missingCriteria) && exp.missingCriteria.length > 0) {
    parts.push(`Critères manquants : ${exp.missingCriteria.join(", ")}.`);
  }

  if (parts.length === 0) {
    return "Aucune explication disponible.";
  }

  return parts.join(" ");
}

/**
 * Get a human-readable verdict label in French.
 */
function getVerdictLabel(verdict: string | undefined): string {
  switch (verdict) {
    case "STRONG_FIT":
      return "Très bon fit";
    case "GOOD_FIT":
      return "Bon fit";
    case "PARTIAL_FIT":
      return "Partiellement adéquat";
    case "WEAK_FIT":
      return "Peu adéquat";
    default:
      return "";
  }
}

/**
 * Draw page footer with page number.
 */
function drawFooter(doc: PDFKit.PDFDocument, pageNumber: number): void {
  doc
    .fontSize(8)
    .fillColor("#999999")
    .text(`Page ${pageNumber}`, MARGIN, FOOTER_Y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
}

/**
 * Draw the table header row.
 * Returns the Y position after the header.
 */
function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  const headerHeight = 25;

  // Header background
  doc
    .rect(MARGIN, y, CONTENT_WIDTH, headerHeight)
    .fill("#2563eb");

  // Header text
  doc.fontSize(9).fillColor("#ffffff");
  doc.text("Rang", COL_RANK_X + 5, y + 8, { width: COL_RANK_W - 10 });
  doc.text("Nom complet", COL_NAME_X + 5, y + 8, { width: COL_NAME_W - 10 });
  doc.text("Score", COL_SCORE_X + 5, y + 8, { width: COL_SCORE_W - 10 });
  doc.text("Récapitulatif", COL_RECAP_X + 5, y + 8, { width: COL_RECAP_W - 10 });

  return y + headerHeight;
}

/**
 * GET /api/v1/jobs/:jobId/export/pdf
 *
 * Generates and streams a PDF report of scored candidates for a job opening.
 * Only includes candidates with status = SCORED, sorted by score descending.
 */
export const exportJobPdf = catchAsync(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const organisationId = req.user?.organisationId;

  if (!organisationId) {
    throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  }

  // Fetch the job and verify it belongs to the user's organisation
  const job = await prisma.jobOpening.findFirst({
    where: {
      id: jobId,
      organisationId,
    },
    select: {
      id: true,
      title: true,
      profileDescription: true,
    },
  });

  if (!job) {
    throw new AppError("Job opening not found", 404, "NOT_FOUND");
  }

  // Fetch only SCORED candidates, sorted by score descending
  const candidates = await prisma.candidate.findMany({
    where: {
      jobOpeningId: jobId,
      status: "SCORED",
    },
    orderBy: {
      score: "desc",
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      score: true,
      scoreExplanation: true,
    },
  });

  // ── Generate PDF ─────────────────────────────────────────────

  // Set response headers BEFORE piping
  const safeTitle = job.title.replace(/[^a-zA-Z0-9_\-. ]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="export-${jobId}.pdf"`
  );

  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    bufferPages: false,
    info: {
      Title: `Export - ${job.title}`,
      Author: "LinkUP",
      Subject: `Résultats de scoring - ${job.title}`,
    },
  });

  // Pipe directly to response
  doc.pipe(res);

  let pageNumber = 1;
  let currentY = MARGIN;

  // ── Page 1 header ──────────────────────────────────────────

  // Title
  doc
    .fontSize(20)
    .fillColor("#1e293b")
    .text(job.title, MARGIN, currentY, {
      width: CONTENT_WIDTH,
      align: "left",
    });
  currentY = doc.y + 10;

  // Description (truncated to ~300 chars for the header)
  const descriptionPreview =
    job.profileDescription.length > 300
      ? job.profileDescription.substring(0, 300) + "…"
      : job.profileDescription;

  doc
    .fontSize(10)
    .fillColor("#64748b")
    .text(descriptionPreview, MARGIN, currentY, {
      width: CONTENT_WIDTH,
      align: "left",
    });
  currentY = doc.y + 15;

  // Metadata line: date + candidate count
  const exportDate = new Date().toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  doc
    .fontSize(10)
    .fillColor("#334155")
    .text(
      `Date d'export : ${exportDate}   |   Candidats analysés : ${candidates.length}`,
      MARGIN,
      currentY,
      { width: CONTENT_WIDTH }
    );
  currentY = doc.y + 20;

  // Separator line
  doc
    .moveTo(MARGIN, currentY)
    .lineTo(PAGE_WIDTH - MARGIN, currentY)
    .strokeColor("#e2e8f0")
    .lineWidth(1)
    .stroke();
  currentY += 15;

  // ── Table ────────────────────────────────────────────────────

  if (candidates.length === 0) {
    doc
      .fontSize(12)
      .fillColor("#94a3b8")
      .text("Aucun candidat avec le statut SCORED.", MARGIN, currentY, {
        width: CONTENT_WIDTH,
        align: "center",
      });
  } else {
    currentY = drawTableHeader(doc, currentY);

    candidates.forEach((candidate, index) => {
      const fullName =
        [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
        "Nom inconnu";
      const scoreText =
        candidate.score !== null ? `${candidate.score}/100` : "N/A";
      const recap = buildRecapText(candidate.scoreExplanation);
      const explanation = candidate.scoreExplanation as Partial<ScoreExplanation> | null;
      const verdictLabel = getVerdictLabel(explanation?.verdict);
      const verdictSuffix = verdictLabel ? ` (${verdictLabel})` : "";

      // Calculate the height needed for the recap text
      const recapHeight = doc.heightOfString(recap, {
        width: COL_RECAP_W - 10,
        fontSize: 8,
      });
      const rowHeight = Math.max(ROW_MIN_HEIGHT, recapHeight + 16);

      // Check if we need a new page (leave room for footer)
      if (currentY + rowHeight > FOOTER_Y - 20) {
        drawFooter(doc, pageNumber);
        doc.addPage();
        pageNumber++;
        currentY = MARGIN;
        // Redraw table header on new page
        currentY = drawTableHeader(doc, currentY);
      }

      // Alternate row background
      if (index % 2 === 0) {
        doc
          .rect(MARGIN, currentY, CONTENT_WIDTH, rowHeight)
          .fill("#f8fafc");
      }

      // Row content
      const textY = currentY + 8;

      // Rank
      doc
        .fontSize(9)
        .fillColor("#1e293b")
        .text(`${index + 1}`, COL_RANK_X + 5, textY, {
          width: COL_RANK_W - 10,
        });

      // Full name
      doc
        .fontSize(9)
        .fillColor("#1e293b")
        .text(fullName, COL_NAME_X + 5, textY, {
          width: COL_NAME_W - 10,
        });

      // Score + verdict
      doc
        .fontSize(9)
        .fillColor("#1e293b")
        .text(`${scoreText}${verdictSuffix}`, COL_SCORE_X + 5, textY, {
          width: COL_SCORE_W - 10 + 20,
        });

      // Recap
      doc
        .fontSize(8)
        .fillColor("#475569")
        .text(recap, COL_RECAP_X + 5, textY, {
          width: COL_RECAP_W - 10,
        });

      currentY += rowHeight;

      // Draw bottom border for the row
      doc
        .moveTo(MARGIN, currentY)
        .lineTo(PAGE_WIDTH - MARGIN, currentY)
        .strokeColor("#e2e8f0")
        .lineWidth(0.5)
        .stroke();
    });
  }

  // Footer on last page
  drawFooter(doc, pageNumber);

  // Finalize the PDF
  doc.end();
});
