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
