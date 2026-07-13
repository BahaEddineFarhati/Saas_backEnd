import { Worker, Job } from "bullmq";
import mammoth from "mammoth";
import { CandidateStatus, LLMFeature, NotificationType } from "@prisma/client";
import { InputJsonValue } from "@prisma/client/runtime/library";
import { redisConnection, CV_PARSING_QUEUE, cvScoringQueue } from "@/lib/queue";
import { downloadFile } from "@/lib/storage";
import { callLLM } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { CvScoringJobData } from "@/workers/cvScorer.worker";

// pdf-parse v2 exports a class; use require for CJS interop
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require("pdf-parse") as {
  PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> };
};

export interface CvParsingJobData {
  candidateId: string;
  fileUrl: string;
}

// Truncate to avoid slow/timeout inference on small local models
const MAX_CV_CHARS = 5000;

const CV_EXTRACTION_SYSTEM_PROMPT = `You are a CV parsing assistant. Extract structured information from the provided CV text.
Return ONLY a valid JSON object with no markdown, no code blocks, no extra text.
Use null for any field you cannot find — never hallucinate or invent data.`;

const CV_EXTRACTION_PROMPT = (rawText: string) => {
  const text = rawText.slice(0, MAX_CV_CHARS);
  return `Extract the following fields from this CV and return a JSON object.

IMPORTANT for name extraction:
- The candidate's full name is usually the largest text at the top of the CV.
- Split it into firstName (given name) and lastName (family name/surname).
- If the name appears in ALL CAPS (e.g. "AYACHI Maher" or "SALEM TEBBINI"), still extract both parts correctly.
- If only one name token is found, put it in lastName and leave firstName null.

{
  "firstName": string | null,
  "lastName": string | null,
  "email": string | null,
  "phone": string | null,
  "summary": string | null,
  "workExperience": Array<{ "company": string, "title": string, "startDate": string | null, "endDate": string | null, "description": string | null }> | null,
  "education": Array<{ "institution": string, "degree": string | null, "field": string | null, "startDate": string | null, "endDate": string | null }> | null,
  "skills": string[] | null,
  "languages": Array<{ "language": string, "level": string | null }> | null
}

CV text:
${text}`;
};

async function extractText(fileBuffer: Buffer, fileUrl: string): Promise<string> {
  const isDocx =
    fileUrl.toLowerCase().endsWith(".docx") ||
    fileUrl.toLowerCase().includes(".docx");

  if (isDocx) {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return result.value;
  }

  const parser = new PDFParse({ data: fileBuffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

function extractJsonFromResponse(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in LLM response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

async function processCvJob(job: Job<CvParsingJobData>): Promise<void> {
  const { candidateId, fileUrl } = job.data;

  console.log(`📥 Processing CV for candidate ${candidateId}, file: ${fileUrl}`);

  // Resolve organisationId and userId for LLM usage tracking
  const candidateMeta = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { jobOpening: { select: { organisationId: true, createdById: true } } },
  });

  const usageContext = candidateMeta
    ? { organisationId: candidateMeta.jobOpening.organisationId, userId: candidateMeta.jobOpening.createdById }
    : undefined;

  const fileBuffer = await downloadFile(fileUrl);
  console.log(`✅ Downloaded file: ${fileBuffer.length} bytes`);

  const rawText = await extractText(fileBuffer, fileUrl);
  console.log(`✅ Extracted text: ${rawText.length} characters`);

  const llmResponse = await callLLM(
    CV_EXTRACTION_PROMPT(rawText),
    CV_EXTRACTION_SYSTEM_PROMPT,
    undefined,
    LLMFeature.CV_PARSING,
    usageContext
  );
  console.log(`✅ LLM response received: ${llmResponse.length} characters`);
  console.log(`📄 LLM response:\n${llmResponse}`);

  const parsedData = extractJsonFromResponse(llmResponse);
  console.log(`✅ Parsed JSON:`, JSON.stringify(parsedData, null, 2));

  await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      parsedJson: parsedData as InputJsonValue,
      status: CandidateStatus.SCORED,
      firstName: typeof parsedData.firstName === "string" ? parsedData.firstName : undefined,
      lastName: typeof parsedData.lastName === "string" ? parsedData.lastName : undefined,
      email: typeof parsedData.email === "string" ? parsedData.email : undefined,
    },
  });
}

/**
 * After a candidate reaches a terminal parsing status (SCORED or FAILED), check whether
 * every candidate in the same job opening is now terminal too. If so, enqueue one scoring
 * job per successfully parsed (SCORED) candidate. Using the candidate's own id as the
 * BullMQ jobId keeps this idempotent if two parsing jobs finish at the same time.
 */
async function notifyJobOpeningCompletion(jobOpeningId: string): Promise<void> {
  const jobOpening = await prisma.jobOpening.findUnique({
    where: { id: jobOpeningId },
    select: { id: true, title: true, organisationId: true },
  });

  if (!jobOpening) return;

  const totalCandidates = await prisma.candidate.count({ where: { jobOpeningId } });
  const successCount = await prisma.candidate.count({
    where: { jobOpeningId, status: CandidateStatus.SCORED },
  });
  const failedCount = await prisma.candidate.count({
    where: { jobOpeningId, status: CandidateStatus.FAILED },
  });

  const hasSuccess = successCount > 0;
  const notificationType = hasSuccess ? NotificationType.JOB_PARSING_COMPLETED : NotificationType.JOB_PARSING_FAILED;
  const title = hasSuccess ? "Analyse terminée" : "Analyse échouée";
  const message = `L'analyse de ${totalCandidates} CVs pour le poste ${jobOpening.title} est terminée. ${successCount} candidats analysés avec succès, ${failedCount} en échec.`;

  const teamMembers = await prisma.user.findMany({
    where: { organisationId: jobOpening.organisationId },
    select: { id: true },
  });

  if (teamMembers.length === 0) return;

  const existingNotification = await prisma.notification.findFirst({
    where: {
      jobOpeningId,
      type: notificationType,
      title,
      message,
    },
  });

  if (existingNotification) return;

  await prisma.notification.createMany({
    data: teamMembers.map((user) => ({
      userId: user.id,
      type: notificationType,
      title,
      message,
      jobOpeningId: jobOpening.id,
    })),
  });
}

async function enqueueScoringIfJobOpeningComplete(candidateId: string): Promise<void> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { jobOpeningId: true },
  });
  if (!candidate) return;

  const remainingPending = await prisma.candidate.count({
    where: { jobOpeningId: candidate.jobOpeningId, status: CandidateStatus.PENDING },
  });
  if (remainingPending > 0) return;

  const scoredCandidates = await prisma.candidate.findMany({
    where: { jobOpeningId: candidate.jobOpeningId, status: CandidateStatus.SCORED },
    select: { id: true },
  });

  await notifyJobOpeningCompletion(candidate.jobOpeningId);

  for (const c of scoredCandidates) {
    const jobData: CvScoringJobData = { candidateId: c.id };
    await cvScoringQueue.add("score-cv", jobData, {
      jobId: `score-cv-${c.id}`,
    });
  }
}

export function startCvParsingWorker(): Worker<CvParsingJobData> {
  const worker = new Worker<CvParsingJobData>(
    CV_PARSING_QUEUE,
    async (job) => {
      try {
        await processCvJob(job);
        await enqueueScoringIfJobOpeningComplete(job.data.candidateId);
      } catch (err) {
        const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1;

        if (isLastAttempt) {
          await prisma.candidate.update({
            where: { id: job.data.candidateId },
            data: { status: CandidateStatus.FAILED },
          });
          await enqueueScoringIfJobOpeningComplete(job.data.candidateId);
        }

        throw err;
      }
    },
    { connection: redisConnection }
  );

  worker.on("completed", (job) => {
    console.log(`✅ CV parsed for candidate ${job.data.candidateId}`);
  });

  worker.on("failed", (job, err) => {
    const id = job?.data.candidateId ?? "unknown";
    console.error(`❌ CV parsing failed for candidate ${id}:`, err.message);
  });

  console.log(`🚀 CV parsing worker started on queue "${CV_PARSING_QUEUE}"`);
  return worker;
}
