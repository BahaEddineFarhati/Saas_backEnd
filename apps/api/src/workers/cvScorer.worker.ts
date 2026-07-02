import { Worker, Job } from "bullmq";
import { InputJsonValue } from "@prisma/client/runtime/library";
import { CandidateStatus } from "@prisma/client";
import { redisConnection, CV_SCORING_QUEUE } from "@/lib/queue";
import { callLLM } from "@/lib/llm";
import { prisma } from "@/lib/prisma";

export interface CvScoringJobData {
  candidateId: string;
}

const VALID_VERDICTS = ["STRONG_FIT", "GOOD_FIT", "PARTIAL_FIT", "WEAK_FIT"] as const;
type Verdict = (typeof VALID_VERDICTS)[number];

interface ScoringResult {
  score: number;
  matchedCriteria: string[];
  missingCriteria: string[];
  strengths: string[];
  verdict: Verdict;
}

const SCORING_SYSTEM_PROMPT = `You are an expert technical recruiter scoring a candidate against a job profile.
Read the job profile description and the candidate's structured CV data, then evaluate the fit.
Return ONLY a valid JSON object with no markdown, no code blocks, no extra text.
Never hallucinate or invent information that is not present in the candidate data — if a criterion from
the job profile cannot be determined from the CV data, it must be listed in "missingCriteria", not assumed.`;

const SCORING_PROMPT = (profileDescription: string, parsedJson: unknown) => `Job profile description:
${profileDescription}

Candidate's structured profile (extracted from their CV):
${JSON.stringify(parsedJson, null, 2)}

Evaluate how well this candidate matches the job profile and return a JSON object with exactly these fields:

{
  "score": number,                  // integer from 0 to 100 — overall fit score
  "matchedCriteria": string[],      // criteria from the job profile that the candidate satisfies
  "missingCriteria": string[],      // criteria from the job profile that the candidate does NOT satisfy
                                     // or that cannot be confirmed from the CV data — never guess
  "strengths": string[],            // notable positives, even if not explicitly required by the profile
  "verdict": string                 // one of: "STRONG_FIT", "GOOD_FIT", "PARTIAL_FIT", "WEAK_FIT"
}`;

// ── Enrichment prompts ──────────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are a professional talent advisor writing concise candidate summaries for hiring teams.
Return ONLY the summary text — no markdown, no headings, no bullet points. Just a plain paragraph.`;

const SUMMARY_PROMPT = (profileDescription: string, parsedJson: unknown) =>
  `Job profile description:
${profileDescription}

Candidate's structured profile (extracted from their CV):
${JSON.stringify(parsedJson, null, 2)}

Write a 4–6 sentence professional summary of this candidate targeted at the specific job described above.
This is NOT a generic bio — speak directly to the candidate's fit for this role, highlighting relevant
experience, skills, and qualifications that matter for this position. Mention any notable gaps briefly
if they exist. Return only the summary paragraph as plain text.`;

const INTERVIEW_SYSTEM_PROMPT = `You are a senior technical interviewer designing targeted interview questions.
Return ONLY a valid JSON array with no markdown, no code blocks, no extra text.`;

const INTERVIEW_PROMPT = (
  profileDescription: string,
  parsedJson: unknown,
  missingCriteria: string[],
  strengths: string[]
) =>
  `Job profile description:
${profileDescription}

Candidate's structured profile (extracted from their CV):
${JSON.stringify(parsedJson, null, 2)}

Scoring analysis — gaps identified (missing criteria):
${missingCriteria.length > 0 ? missingCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n") : "None identified"}

Scoring analysis — strengths identified:
${strengths.length > 0 ? strengths.map((s, i) => `${i + 1}. ${s}`).join("\n") : "None identified"}

Generate exactly 7 interview questions as a JSON array of objects. Each object must have:
- "question" (string): the interview question
- "rationale" (string): one sentence explaining why this question is being asked

The 7 questions must be distributed as follows:
- Questions 1–3: Probe the candidate's MISSING CRITERIA (the gaps listed above). Each question should explore whether the candidate has hidden experience or can compensate for the gap.
- Questions 4–5: Validate the candidate's STRENGTHS listed above. Each question should dig deeper into a claimed strength to verify depth of expertise.
- Questions 6–7: BEHAVIOURAL questions relevant to this specific role. Use the STAR format style — ask about past situations that reveal the candidate's working style and cultural fit.

Return only the JSON array.`;

export interface InterviewQuestion {
  question: string;
  rationale: string;
}

function extractJsonArrayFromResponse(raw: string): unknown[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON array found in LLM response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown[];
}

function validateInterviewQuestions(data: unknown[]): InterviewQuestion[] {
  if (data.length !== 7) {
    throw new Error(`Expected exactly 7 interview questions, got ${data.length}`);
  }

  return data.map((item, index) => {
    const obj = item as Record<string, unknown>;
    if (typeof obj.question !== "string" || !obj.question.trim()) {
      throw new Error(`Question ${index + 1}: missing or invalid "question" field`);
    }
    if (typeof obj.rationale !== "string" || !obj.rationale.trim()) {
      throw new Error(`Question ${index + 1}: missing or invalid "rationale" field`);
    }
    return { question: obj.question, rationale: obj.rationale };
  });
}

function extractJsonFromResponse(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in LLM response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function validateScoringResult(data: Record<string, unknown>): ScoringResult {
  const score = Math.round(Number(data.score));
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`Invalid score returned by LLM: ${JSON.stringify(data.score)}`);
  }

  if (!Array.isArray(data.matchedCriteria) || !Array.isArray(data.missingCriteria) || !Array.isArray(data.strengths)) {
    throw new Error("matchedCriteria, missingCriteria, and strengths must be arrays");
  }

  if (typeof data.verdict !== "string" || !VALID_VERDICTS.includes(data.verdict as Verdict)) {
    throw new Error(`Invalid verdict returned by LLM: ${JSON.stringify(data.verdict)}`);
  }

  return {
    score,
    matchedCriteria: data.matchedCriteria as string[],
    missingCriteria: data.missingCriteria as string[],
    strengths: data.strengths as string[],
    verdict: data.verdict as Verdict,
  };
}

async function processScoringJob(job: Job<CvScoringJobData>): Promise<void> {
  const { candidateId } = job.data;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      parsedJson: true,
      jobOpening: { select: { profileDescription: true } },
    },
  });

  if (!candidate) {
    throw new Error(`Candidate ${candidateId} not found`);
  }

  console.log(`🎯 Scoring candidate ${candidateId}`);

  const llmResponse = await callLLM(
    SCORING_PROMPT(candidate.jobOpening.profileDescription, candidate.parsedJson),
    SCORING_SYSTEM_PROMPT
  );

  const result = validateScoringResult(extractJsonFromResponse(llmResponse));

  await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      score: result.score,
      scoreExplanation: result as unknown as InputJsonValue,
      status: CandidateStatus.SCORED,
    },
  });

  console.log(`✅ Candidate ${candidateId} scored: ${result.score} (${result.verdict})`);

  // ── Enrichment phase — runs after scoring, failures do not affect score ──
  await enrichCandidate(
    candidateId,
    candidate.parsedJson,
    candidate.jobOpening.profileDescription,
    result
  );
}

/**
 * Generate a role-specific summary and interview questions for a scored candidate.
 * Each LLM call is independent — if one fails, the other can still succeed.
 * Failures are logged but never throw — the candidate's score and status are preserved.
 */
export async function enrichCandidate(
  candidateId: string,
  parsedJson: unknown,
  profileDescription: string,
  scoringResult: ScoringResult
): Promise<void> {
  console.log(`📝 Enriching candidate ${candidateId} (summary + interview questions)`);

  const [summaryOutcome, questionsOutcome] = await Promise.allSettled([
    generateSummary(parsedJson, profileDescription),
    generateInterviewQuestions(
      parsedJson,
      profileDescription,
      scoringResult.missingCriteria,
      scoringResult.strengths
    ),
  ]);

  const updateData: Record<string, unknown> = {};

  if (summaryOutcome.status === "fulfilled") {
    updateData.summary = summaryOutcome.value;
    console.log(`✅ Summary generated for candidate ${candidateId}`);
  } else {
    console.error(
      `⚠️ Summary generation failed for candidate ${candidateId}:`,
      summaryOutcome.reason instanceof Error ? summaryOutcome.reason.message : summaryOutcome.reason
    );
  }

  if (questionsOutcome.status === "fulfilled") {
    updateData.interviewQuestions = questionsOutcome.value as unknown as InputJsonValue;
    console.log(`✅ Interview questions generated for candidate ${candidateId}`);
  } else {
    console.error(
      `⚠️ Interview questions generation failed for candidate ${candidateId}:`,
      questionsOutcome.reason instanceof Error ? questionsOutcome.reason.message : questionsOutcome.reason
    );
  }

  // Only write to DB if at least one enrichment succeeded
  if (Object.keys(updateData).length > 0) {
    await prisma.candidate.update({
      where: { id: candidateId },
      data: updateData,
    });
  }
}

async function generateSummary(
  parsedJson: unknown,
  profileDescription: string
): Promise<string> {
  const response = await callLLM(
    SUMMARY_PROMPT(profileDescription, parsedJson),
    SUMMARY_SYSTEM_PROMPT
  );

  const summary = response.trim();
  if (!summary) {
    throw new Error("LLM returned an empty summary");
  }
  return summary;
}

async function generateInterviewQuestions(
  parsedJson: unknown,
  profileDescription: string,
  missingCriteria: string[],
  strengths: string[]
): Promise<InterviewQuestion[]> {
  const response = await callLLM(
    INTERVIEW_PROMPT(profileDescription, parsedJson, missingCriteria, strengths),
    INTERVIEW_SYSTEM_PROMPT
  );

  const rawArray = extractJsonArrayFromResponse(response);
  return validateInterviewQuestions(rawArray);
}

export function startCvScoringWorker(): Worker<CvScoringJobData> {
  const worker = new Worker<CvScoringJobData>(
    CV_SCORING_QUEUE,
    async (job) => {
      try {
        await processScoringJob(job);
      } catch (err) {
        const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1;

        if (isLastAttempt) {
          // Parsing already succeeded — scoring failure must not flip status to FAILED.
          // score/scoreExplanation simply stay null.
          console.error(
            `❌ Scoring permanently failed for candidate ${job.data.candidateId}:`,
            err instanceof Error ? err.message : err
          );
        }

        throw err;
      }
    },
    { connection: redisConnection }
  );

  worker.on("completed", (job) => {
    console.log(`✅ CV scored for candidate ${job.data.candidateId}`);
  });

  worker.on("failed", (job, err) => {
    const id = job?.data.candidateId ?? "unknown";
    console.error(`❌ CV scoring failed for candidate ${id}:`, err.message);
  });

  console.log(`🚀 CV scoring worker started on queue "${CV_SCORING_QUEUE}"`);
  return worker;
}
