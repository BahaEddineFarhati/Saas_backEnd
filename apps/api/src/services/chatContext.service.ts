import { prisma } from "@/lib/prisma";
import { CandidateStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types for safe access to JSON fields stored as Prisma.JsonValue
// ---------------------------------------------------------------------------

interface WorkExperienceEntry {
  company?: string;
  title?: string;
}

interface EducationEntry {
  institution?: string;
  school?: string;
  degree?: string;
  field?: string;
}

interface LanguageEntry {
  language?: string;
  level?: string;
}

interface ParsedCvJson {
  skills?: string[] | null;
  workExperience?: WorkExperienceEntry[] | null;
  education?: EducationEntry[] | null;
  languages?: LanguageEntry[] | null;
  summary?: string | null;
}

interface ScoreExplanationJson {
  verdict?: string;
  matchedCriteria?: string[];
  missingCriteria?: string[];
  strengths?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParsed(raw: unknown): ParsedCvJson {
  if (!raw || typeof raw !== "object") return {};
  return raw as ParsedCvJson;
}

function safeExplanation(raw: unknown): ScoreExplanationJson {
  if (!raw || typeof raw !== "object") return {};
  return raw as ScoreExplanationJson;
}

function joinList(items: string[] | null | undefined): string {
  if (!items || items.length === 0) return "N/A";
  return items.join(", ");
}

function buildCandidateBlock(candidate: {
  firstName: string | null;
  lastName: string | null;
  score: number | null;
  status: CandidateStatus;
  summary: string | null;
  parsedJson: unknown;
  scoreExplanation: unknown;
}): string {
  const name = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Unknown";
  const parsed = safeParsed(candidate.parsedJson);
  const explanation = safeExplanation(candidate.scoreExplanation);

  const workExperience =
    parsed.workExperience && parsed.workExperience.length > 0
      ? parsed.workExperience
          .slice(0, 5)
          .map((e) => `${e.company ?? "?"} — ${e.title ?? "?"}`)
          .join("; ")
      : "N/A";

  const education =
    parsed.education && parsed.education.length > 0
      ? (() => {
          const edu = parsed.education![0];
          const parts = [edu.degree, edu.field].filter(Boolean).join(" in ");
          const inst = edu.institution ?? edu.school;
          if (parts) {
            return inst ? `${parts} at ${inst}` : parts;
          }
          return inst ?? "N/A";
        })()
      : "N/A";

  const languages =
    parsed.languages && parsed.languages.length > 0
      ? parsed.languages.map((l) => `${l.language ?? "?"}${l.level ? ` (${l.level})` : ""}`).join(", ")
      : "N/A";

  const summaryText = candidate.summary ?? parsed.summary ?? "N/A";

  return `--- Candidate ---
Name: ${name}
Score: ${candidate.score ?? "N/A"}/100
Verdict: ${explanation.verdict ?? "N/A"}
Status: ${candidate.status}
Matched criteria: ${joinList(explanation.matchedCriteria)}
Missing criteria: ${joinList(explanation.missingCriteria)}
Strengths: ${joinList(explanation.strengths)}
Skills: ${joinList(parsed.skills)}
Experience: ${workExperience}
Education: ${education}
Languages: ${languages}
Summary: ${summaryText}`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Builds a complete, grounded system prompt for the AI chat assistant.
 * The prompt contains all relevant information about the job opening and its
 * scored candidates so that the LLM can answer recruiter questions accurately.
 *
 * Candidate selection rule:
 *  - ≤ 30 scored candidates  → include all
 *  - > 30 scored candidates  → top 20 by score + ALL shortlisted (deduplicated)
 */
export async function buildChatContext(jobOpeningId: string): Promise<string> {
  // ── Fetch job opening ────────────────────────────────────────────────────
  const jobOpening = await prisma.jobOpening.findUnique({
    where: { id: jobOpeningId },
    select: { title: true, profileDescription: true },
  });

  if (!jobOpening) {
    throw new Error(`Job opening ${jobOpeningId} not found`);
  }

  // ── Fetch all relevant candidates ────────────────────────────────────────
  const allScored = await prisma.candidate.findMany({
    where: {
      jobOpeningId,
      status: {
        in: [
          CandidateStatus.SCORED,
          CandidateStatus.SHORTLISTED,
          CandidateStatus.REJECTED,
          CandidateStatus.OFFERED,
        ],
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      score: true,
      status: true,
      summary: true,
      parsedJson: true,
      scoreExplanation: true,
    },
    orderBy: { score: "desc" },
  });

  // ── Candidate selection limit ────────────────────────────────────────────
  let selectedCandidates = allScored;

  if (allScored.length > 30) {
    const top20 = allScored.slice(0, 20);
    const top20Ids = new Set(top20.map((c) => c.id));

    const shortlisted = allScored.filter(
      (c) => c.status === CandidateStatus.SHORTLISTED && !top20Ids.has(c.id)
    );

    selectedCandidates = [...top20, ...shortlisted];
  }

  // ── Build statistics ─────────────────────────────────────────────────────
  const totalUploaded = await prisma.candidate.count({ where: { jobOpeningId } });
  const totalScored = allScored.length;
  const totalShortlisted = allScored.filter((c) => c.status === CandidateStatus.SHORTLISTED).length;
  const totalRejected = allScored.filter((c) => c.status === CandidateStatus.REJECTED).length;
  const totalOffered = allScored.filter((c) => c.status === CandidateStatus.OFFERED).length;

  const scores = allScored.map((c) => c.score ?? 0);
  const avgScore =
    scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  const explanations = allScored.map((c) => safeExplanation(c.scoreExplanation));
  const verdictCounts = {
    STRONG_FIT: explanations.filter((e) => e.verdict === "STRONG_FIT").length,
    GOOD_FIT: explanations.filter((e) => e.verdict === "GOOD_FIT").length,
    PARTIAL_FIT: explanations.filter((e) => e.verdict === "PARTIAL_FIT").length,
    WEAK_FIT: explanations.filter((e) => e.verdict === "WEAK_FIT").length,
  };

  const statsBlock = `=== STATISTICS ===
Total candidates uploaded: ${totalUploaded}
Total scored: ${totalScored}
Total shortlisted: ${totalShortlisted}
Total rejected: ${totalRejected}
Total offered: ${totalOffered}
Average score: ${avgScore}/100
Score distribution: STRONG_FIT: ${verdictCounts.STRONG_FIT}, GOOD_FIT: ${verdictCounts.GOOD_FIT}, PARTIAL_FIT: ${verdictCounts.PARTIAL_FIT}, WEAK_FIT: ${verdictCounts.WEAK_FIT}`;

  // ── Build candidate blocks ───────────────────────────────────────────────
  const candidateBlocks = selectedCandidates.map(buildCandidateBlock).join("\n\n");

  // ── Assemble final system prompt ─────────────────────────────────────────
  return `You are a recruitment assistant for a specific job opening. You have full knowledge of the job description and all scored candidates listed below.

RULES:
- Answer ONLY questions related to this job opening and its candidates
- NEVER invent information not present in the context below
- If asked about a candidate not in the context, explain they may not have been included due to context limits or were not yet scored
- Be concise, direct, and professional
- When listing candidates, always include their score and verdict
- Respond in the same language the recruiter uses (French or English)

=== JOB OPENING ===
Title: ${jobOpening.title}
Profile Description:
${jobOpening.profileDescription}

=== CANDIDATES (${selectedCandidates.length} included out of ${totalScored} scored) ===

${candidateBlocks}

${statsBlock}`;
}
