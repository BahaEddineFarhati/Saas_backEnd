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
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const FOOTER_Y = PAGE_HEIGHT - 35;

// Table column widths (total = CONTENT_WIDTH)
const COL_RANK_W = 35;
const COL_NAME_W = 110;
const COL_SCORE_W = 45;
const COL_RECAP_W = CONTENT_WIDTH - COL_RANK_W - COL_NAME_W - COL_SCORE_W;

// Column X positions
const COL_RANK_X = MARGIN;
const COL_NAME_X = COL_RANK_X + COL_RANK_W;
const COL_SCORE_X = COL_NAME_X + COL_NAME_W;
const COL_RECAP_X = COL_SCORE_X + COL_SCORE_W;

const ROW_PAD = 6;
const ROW_MIN_HEIGHT = 28;

// Colors
const CLR_HEADER_BG = "#1e3a5f";
const CLR_HEADER_TEXT = "#ffffff";
const CLR_TITLE = "#111827";
const CLR_SUBTITLE = "#4b5563";
const CLR_BODY = "#1f2937";
const CLR_RECAP = "#374151";
const CLR_MUTED = "#6b7280";
const CLR_BORDER = "#d1d5db";
const CLR_ROW_ALT = "#f3f4f6";
const CLR_ACCENT = "#2563eb";
const CLR_SCORE_HIGH = "#059669";
const CLR_SCORE_MED = "#d97706";
const CLR_SCORE_LOW = "#dc2626";

/**
 * Build structured recap text with line breaks between sections.
 */
function buildRecapText(explanation: unknown): string {
  if (!explanation || typeof explanation !== "object") {
    return "Aucune explication disponible.";
  }

  const exp = explanation as Partial<ScoreExplanation>;
  const parts: string[] = [];

  if (Array.isArray(exp.strengths) && exp.strengths.length > 0) {
    parts.push(`[+] Points forts : ${exp.strengths.join(", ")}`);
  }
  if (Array.isArray(exp.matchedCriteria) && exp.matchedCriteria.length > 0) {
    parts.push(`[v] Criteres remplis : ${exp.matchedCriteria.join(", ")}`);
  }
  if (Array.isArray(exp.missingCriteria) && exp.missingCriteria.length > 0) {
    parts.push(`[-] Manquants : ${exp.missingCriteria.join(", ")}`);
  }

  return parts.length > 0 ? parts.join("\n") : "Aucune explication disponible.";
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
      return "Fit partiel";
    case "WEAK_FIT":
      return "Peu adéquat";
    default:
      return "";
  }
}

/**
 * Get color for score value.
 */
function getScoreColor(score: number | null): string {
  if (score === null) return CLR_MUTED;
  if (score >= 70) return CLR_SCORE_HIGH;
  if (score >= 45) return CLR_SCORE_MED;
  return CLR_SCORE_LOW;
}

/**
 * Draw page footer with page number and branding.
 */
function drawFooter(
  doc: PDFKit.PDFDocument,
  pageNumber: number,
  totalPages: number
): void {
  // Thin separator line
  doc
    .moveTo(MARGIN, FOOTER_Y - 5)
    .lineTo(PAGE_WIDTH - MARGIN, FOOTER_Y - 5)
    .strokeColor(CLR_BORDER)
    .lineWidth(0.5)
    .stroke();

  doc
    .fontSize(7)
    .fillColor(CLR_MUTED)
    .text("LinkUP — Export automatique", MARGIN, FOOTER_Y, {
      width: CONTENT_WIDTH / 2,
      align: "left",
    });

  doc
    .fontSize(7)
    .fillColor(CLR_MUTED)
    .text(`Page ${pageNumber} / ${totalPages}`, MARGIN + CONTENT_WIDTH / 2, FOOTER_Y, {
      width: CONTENT_WIDTH / 2,
      align: "right",
    });
}

/**
 * Draw the table header row.
 */
function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  const headerH = 22;

  // Header background
  doc.rect(MARGIN, y, CONTENT_WIDTH, headerH).fill(CLR_HEADER_BG);

  // Header text
  const textY = y + 7;
  doc.fontSize(8).fillColor(CLR_HEADER_TEXT);
  doc.text("#", COL_RANK_X + 4, textY, { width: COL_RANK_W - 8 });
  doc.text("Nom complet", COL_NAME_X + 4, textY, { width: COL_NAME_W - 8 });
  doc.text("Score", COL_SCORE_X + 4, textY, { width: COL_SCORE_W - 8 });
  doc.text("Récapitulatif", COL_RECAP_X + 6, textY, { width: COL_RECAP_W - 12 });

  return y + headerH;
}

// ═══════════════════════════════════════════════════════════════
//  GET /api/v1/jobs/:jobId/export/pdf
// ═══════════════════════════════════════════════════════════════
export const exportJobPdf = catchAsync(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const organisationId = req.user?.organisationId;

  if (!organisationId) {
    throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  }

  // Fetch the job and verify it belongs to the user's organisation
  const job = await prisma.jobOpening.findFirst({
    where: { id: jobId, organisationId },
    select: { id: true, title: true, profileDescription: true },
  });

  if (!job) {
    throw new AppError("Job opening not found", 404, "NOT_FOUND");
  }

  // Fetch only SCORED candidates, sorted by score descending
  const candidates = await prisma.candidate.findMany({
    where: { jobOpeningId: jobId, status: "SCORED" },
    orderBy: { score: "desc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      score: true,
      scoreExplanation: true,
    },
  });

  // ── Set response headers BEFORE piping ──────────────────────
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="export-${jobId}.pdf"`
  );

  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    bufferPages: true, // Enable buffering to get total page count
    info: {
      Title: `Export — ${job.title}`,
      Author: "LinkUP",
      Subject: `Résultats de scoring — ${job.title}`,
    },
  });

  // Pipe directly to response
  doc.pipe(res);

  let currentY = MARGIN;

  // ── Page header ─────────────────────────────────────────────

  // Accent bar at top
  doc.rect(MARGIN, currentY, CONTENT_WIDTH, 4).fill(CLR_ACCENT);
  currentY += 14;

  // Title
  doc
    .fontSize(18)
    .fillColor(CLR_TITLE)
    .text(job.title, MARGIN, currentY, {
      width: CONTENT_WIDTH,
      align: "left",
    });
  currentY = doc.y + 6;

  // Description (truncated for the header)
  const descPreview =
    job.profileDescription.length > 280
      ? job.profileDescription.substring(0, 280) + "…"
      : job.profileDescription;

  doc
    .fontSize(9)
    .fillColor(CLR_SUBTITLE)
    .text(descPreview, MARGIN, currentY, {
      width: CONTENT_WIDTH,
      lineGap: 2,
    });
  currentY = doc.y + 10;

  // Metadata boxes
  const exportDate = new Date().toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Light background bar for metadata
  doc.rect(MARGIN, currentY, CONTENT_WIDTH, 20).fill("#eef2ff");
  doc
    .fontSize(8)
    .fillColor(CLR_BODY)
    .text(
      `Date : ${exportDate}     |     ${candidates.length} candidat${candidates.length > 1 ? "s" : ""} evalue${candidates.length > 1 ? "s" : ""}`,
      MARGIN + 8,
      currentY + 6,
      { width: CONTENT_WIDTH - 16 }
    );
  currentY += 28;

  // ── Table ───────────────────────────────────────────────────

  if (candidates.length === 0) {
    doc
      .fontSize(11)
      .fillColor(CLR_MUTED)
      .text(
        "Aucun candidat avec le statut SCORED.",
        MARGIN,
        currentY + 20,
        { width: CONTENT_WIDTH, align: "center" }
      );
  } else {
    currentY = drawTableHeader(doc, currentY);

    candidates.forEach((candidate, index) => {
      const fullName =
        [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
        "Nom inconnu";
      const scoreText =
        candidate.score !== null ? `${candidate.score}` : "–";
      const recap = buildRecapText(candidate.scoreExplanation);
      const explanation = candidate.scoreExplanation as Partial<ScoreExplanation> | null;
      const verdictLabel = getVerdictLabel(explanation?.verdict);

      // Calculate height needed for recap text (using 7.5pt)
      doc.fontSize(7.5);
      const recapHeight = doc.heightOfString(recap, {
        width: COL_RECAP_W - 12,
      });
      // Also account for verdict label height under the score
      const scoreBlockH = 28; // score number + verdict label
      const rowHeight = Math.max(ROW_MIN_HEIGHT, recapHeight + 2 * ROW_PAD, scoreBlockH);

      // Check if we need a new page (leave room for footer)
      if (currentY + rowHeight > FOOTER_Y - 15) {
        doc.addPage();
        currentY = MARGIN;
        currentY = drawTableHeader(doc, currentY);
      }

      // Alternate row background
      if (index % 2 === 0) {
        doc.rect(MARGIN, currentY, CONTENT_WIDTH, rowHeight).fill(CLR_ROW_ALT);
      }

      const textY = currentY + ROW_PAD;

      // ── Rank ──
      doc
        .fontSize(8)
        .fillColor(CLR_MUTED)
        .text(`${index + 1}`, COL_RANK_X + 4, textY + 2, {
          width: COL_RANK_W - 8,
          align: "center",
        });

      // ── Full name ──
      doc
        .fontSize(8.5)
        .fillColor(CLR_BODY)
        .text(fullName, COL_NAME_X + 4, textY + 2, {
          width: COL_NAME_W - 8,
        });

      // ── Score (large number) ──
      doc
        .fontSize(12)
        .fillColor(getScoreColor(candidate.score))
        .text(scoreText, COL_SCORE_X + 2, textY, {
          width: COL_SCORE_W - 4,
          align: "center",
        });

      // Verdict label under score
      if (verdictLabel) {
        doc
          .fontSize(6)
          .fillColor(CLR_MUTED)
          .text(verdictLabel, COL_SCORE_X + 2, textY + 15, {
            width: COL_SCORE_W - 4,
            align: "center",
          });
      }

      // ── Recap (multiline, structured) ──
      doc
        .fontSize(7.5)
        .fillColor(CLR_RECAP)
        .text(recap, COL_RECAP_X + 6, textY, {
          width: COL_RECAP_W - 12,
          lineGap: 1.5,
        });

      currentY += rowHeight;

      // Row bottom border
      doc
        .moveTo(MARGIN, currentY)
        .lineTo(PAGE_WIDTH - MARGIN, currentY)
        .strokeColor(CLR_BORDER)
        .lineWidth(0.3)
        .stroke();
    });
  }

  // ── Footers on all pages ────────────────────────────────────
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i + 1, totalPages);
  }

  // Finalize the PDF
  doc.end();
});
