import { Worker, Job } from "bullmq";
import mammoth from "mammoth";
import { CandidateStatus } from "@prisma/client";
import { InputJsonValue } from "@prisma/client/runtime/library";
import { redisConnection, CV_PARSING_QUEUE } from "@/lib/queue";
import { downloadFile } from "@/lib/storage";
import { callLLM } from "@/lib/llm";
import { prisma } from "@/lib/prisma";

// pdf-parse v2 exports a class; use require for CJS interop
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require("pdf-parse") as {
  PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> };
};

export interface CvParsingJobData {
  candidateId: string;
  fileUrl: string;
}

const CV_EXTRACTION_SYSTEM_PROMPT = `You are a CV parsing assistant. Extract structured information from the provided CV text.
Return ONLY a valid JSON object with no markdown, no code blocks, no extra text.
Use null for any field you cannot find — never hallucinate or invent data.`;

const CV_EXTRACTION_PROMPT = (rawText: string) => `Extract the following fields from this CV and return a JSON object:
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
${rawText}`;

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
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  return JSON.parse(cleaned) as Record<string, unknown>;
}

async function processCvJob(job: Job<CvParsingJobData>): Promise<void> {
  const { candidateId, fileUrl } = job.data;

  console.log(`📥 Processing CV for candidate ${candidateId}, file: ${fileUrl}`);

  const fileBuffer = await downloadFile(fileUrl);
  console.log(`✅ Downloaded file: ${fileBuffer.length} bytes`);

  const rawText = await extractText(fileBuffer, fileUrl);
  console.log(`✅ Extracted text: ${rawText.length} characters`);

  const llmResponse = await callLLM(
    CV_EXTRACTION_PROMPT(rawText),
    CV_EXTRACTION_SYSTEM_PROMPT
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

export function startCvParsingWorker(): Worker<CvParsingJobData> {
  const worker = new Worker<CvParsingJobData>(
    CV_PARSING_QUEUE,
    async (job) => {
      try {
        await processCvJob(job);
      } catch (err) {
        const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1;

        if (isLastAttempt) {
          await prisma.candidate.update({
            where: { id: job.data.candidateId },
            data: { status: CandidateStatus.FAILED },
          });
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
