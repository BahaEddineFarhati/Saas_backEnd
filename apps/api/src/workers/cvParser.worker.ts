import { Worker, Job } from "bullmq";
import { CandidateStatus } from "@prisma/client";
import { InputJsonValue } from "@prisma/client/runtime/library";
import { redisConnection, CV_PARSING_QUEUE } from "@/lib/queue";
import { downloadFile } from "@/lib/storage";
import { callLLM } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { extractText, ParsingQualityError } from "@/lib/extractText";

export interface CvParsingJobData {
  candidateId: string;
  fileUrl: string;
}

const MAX_CV_CHARS = 5000;

// ── Shared system prompt ──────────────────────────────────────────────────────

const SYSTEM = `You are a CV parsing assistant. Return ONLY a valid JSON object — no markdown, no code blocks, no extra text. Use null for missing fields, never invent data.`;

// ── Section prompts ───────────────────────────────────────────────────────────

const PERSONAL_PROMPT = (text: string) =>
  `Extract ONLY the personal and contact information from this CV.

Rules for name:
- The full name is usually the first or largest line.
- Split into firstName (given name) and lastName (family/surname).
- Handle ALL-CAPS names (e.g. "AYACHI Maher" → firstName:"Maher", lastName:"AYACHI").
- Format "LastName FirstName" is common in French/Arabic CVs — identify accordingly.
- If only one token, put it in lastName.

Return this exact JSON shape:
{
  "firstName": string | null,
  "lastName": string | null,
  "email": string | null,
  "phone": string | null,
  "summary": string | null
}

CV text:
${text}`;

const WORK_PROMPT = (text: string) =>
  `Extract ONLY the work experience / professional history from this CV.

Return this exact JSON shape:
{
  "workExperience": Array<{
    "company": string,
    "title": string,
    "startDate": string | null,
    "endDate": string | null,
    "description": string | null
  }> | null
}

If no work experience is found, return: { "workExperience": null }

CV text:
${text}`;

const EDUCATION_PROMPT = (text: string) =>
  `Extract ONLY the education and academic background from this CV.

Return this exact JSON shape:
{
  "education": Array<{
    "institution": string,
    "degree": string | null,
    "field": string | null,
    "startDate": string | null,
    "endDate": string | null
  }> | null
}

If no education is found, return: { "education": null }

CV text:
${text}`;

const SKILLS_PROMPT = (text: string) =>
  `Extract ONLY the technical skills and spoken languages from this CV.

Rules:
- skills: flat list of individual skills (tools, technologies, frameworks, methods).
  Split grouped entries (e.g. "Python / Django / FastAPI") into separate items.
- languages: spoken/written languages with proficiency level when stated.

Return this exact JSON shape:
{
  "skills": string[] | null,
  "languages": Array<{ "language": string, "level": string | null }> | null
}

If none found, use null for that field.

CV text:
${text}`;

// ── JSON extraction helper ────────────────────────────────────────────────────

function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in LLM response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

// ── Section caller — gracefully degrades on parse failure ────────────────────

async function callSection(prompt: string): Promise<Record<string, unknown>> {
  const raw = await callLLM(prompt, SYSTEM);
  return extractJson(raw);
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processCvJob(job: Job<CvParsingJobData>): Promise<void> {
  const { candidateId, fileUrl } = job.data;

  const fileBuffer = await downloadFile(fileUrl);
  const rawText = await extractText(fileBuffer, fileUrl);
  const text = rawText.slice(0, MAX_CV_CHARS);

  // Sequential for local LLM (Ollama can't handle concurrent contexts),
  // parallel for cloud where the provider scales independently.
  const isCloud = (process.env.LLM_PROVIDER ?? "local") === "cloud";

  let personal: Record<string, unknown>;
  let work: Record<string, unknown>;
  let education: Record<string, unknown>;
  let skillsLangs: Record<string, unknown>;

  if (isCloud) {
    [personal, work, education, skillsLangs] = await Promise.all([
      callSection(PERSONAL_PROMPT(text)),
      callSection(WORK_PROMPT(text)),
      callSection(EDUCATION_PROMPT(text)),
      callSection(SKILLS_PROMPT(text)),
    ]);
  } else {
    personal    = await callSection(PERSONAL_PROMPT(text));
    work        = await callSection(WORK_PROMPT(text));
    education   = await callSection(EDUCATION_PROMPT(text));
    skillsLangs = await callSection(SKILLS_PROMPT(text));
  }

  const parsedData: Record<string, unknown> = {
    ...personal,
    ...work,
    ...education,
    ...skillsLangs,
  };

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

// ── Worker bootstrap ──────────────────────────────────────────────────────────

export function startCvParsingWorker(): Worker<CvParsingJobData> {
  const worker = new Worker<CvParsingJobData>(
    CV_PARSING_QUEUE,
    async (job) => {
      try {
        await processCvJob(job);
      } catch (err) {
        const isQualityError = err instanceof ParsingQualityError;
        const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1;

        if (isQualityError || isLastAttempt) {
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
