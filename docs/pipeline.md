# CV Parsing & Scoring Pipeline — Technical Documentation

> **Last updated**: 2026-07-08  
> **Codebase version**: as of current `main` branch  
> **Maintainer**: Linkup Engineering Team

---

## 1. Overview

### Pipeline Diagram

```mermaid
flowchart LR
    A["📁 File Upload\n(multipart/form-data)"] --> B["✅ Validation\n(multer)"]
    B --> C["☁️ Object Storage\n(S3 / R2 / MinIO)"]
    C --> D["📋 Queue: cv-parsing\n(BullMQ)"]
    D --> E["📄 Text Extraction\n(pdf-parse / mammoth)"]
    E --> F["🤖 LLM Parsing\n(callLLM)"]
    F --> G["💾 DB Update\n(parsedJson, status: SCORED)"]
    G --> H{"All CVs\nparsed?"}
    H -->|No| D
    H -->|Yes| I["📋 Queue: cv-scoring\n(BullMQ)"]
    I --> J["🎯 LLM Scoring\n(callLLM)"]
    J --> K["💾 DB Update\n(score, scoreExplanation)"]
    K --> L["📝 LLM Enrichment\n(summary + interview Qs)"]
    L --> M["💾 DB Update\n(summary, interviewQuestions)"]
```

### How it works — plain language

When a recruiter clicks **"Analyser les CVs"** on the frontend, the selected PDF or DOCX files are uploaded to the API server. The server validates each file (type, size), stores it in object storage (Cloudflare R2 in production, MinIO locally), creates a `Candidate` database row in `PENDING` status, and pushes a job into a Redis-backed queue called `cv-parsing`.

A background worker picks up each parsing job: it downloads the file from storage, extracts raw text (using `pdf-parse` for PDFs or `mammoth` for DOCX), then sends that text to an LLM with a structured prompt asking it to return a JSON object containing the candidate's name, email, phone, summary, work experience, education, skills, and languages. The parsed JSON is saved to the database and the candidate status moves to `SCORED`.

Once **all** candidates for a given job opening have finished parsing (no more `PENDING` records), the worker enqueues one scoring job per successfully parsed candidate into a second queue called `cv-scoring`. The scoring worker sends the parsed CV data alongside the job's profile description to the LLM, which returns a 0–100 fit score, matched and missing criteria, strengths, and a verdict (`STRONG_FIT` / `GOOD_FIT` / `PARTIAL_FIT` / `WEAK_FIT`). This result is persisted as `score` and `scoreExplanation`.

Immediately after scoring, an enrichment phase runs inside the same worker: two parallel LLM calls generate (1) a role-specific candidate summary and (2) seven tailored interview questions. These are stored on the candidate row. If either enrichment call fails, the candidate's score and status are preserved — enrichment failures are non-blocking.

The recruiter sees scores, summaries, and interview questions appear in the UI as each candidate finishes processing.

---

## 2. Stage-by-Stage Technical Breakdown

---

### 2.1 File Upload and Validation

**What happens**: The recruiter uploads one or more CV files via a `multipart/form-data` POST request. The multer middleware intercepts the request, validates each file against type and size rules, and stores the raw buffers in memory (no disk writes). A secondary validation function runs after multer to collect detailed error reports. If validation passes, each file proceeds to object storage upload and candidate creation.

**Responsible files**:
- `src/lib/multer.ts` — multer configuration, file filter, and `validateUploadedFiles()` function
- `src/controllers/jobController.ts` — `uploadCandidates` controller (line 234)
- `src/routes/jobRoutes.ts` — route definition `POST /:jobId/candidates/upload` (line 101)

**Input**: HTTP `multipart/form-data` with field name `files` containing 1–100 files.

**Output**: HTTP 202 response with an array of created candidate objects `{ id, status: "PENDING", rawFileUrl }`.

**Configuration**:

| Parameter | Value |
|-----------|-------|
| Max file size | 5 MB per file |
| Max files per request | 100 |
| Accepted MIME types | `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX) |
| Storage strategy | `multer.memoryStorage()` — files are kept in memory buffers, never written to disk |

**Libraries used**:
- **multer** (`^1.4.5-lts.1`) — HTTP multipart handling. Chosen for its Express integration and memory storage support (files go directly to R2 without touching disk).

**Validation failure behaviour**:
- If multer's built-in `fileFilter` rejects a file (wrong MIME type), an error is thrown immediately.
- If `validateUploadedFiles()` detects issues (empty request, too many files, oversized file, wrong type), it returns an array of `{ filename, reason }` objects. The controller throws an `AppError` (400, `INVALID_FILES`) with a concatenated error message.
- If the job opening doesn't exist or doesn't belong to the user's organisation, a 404 is returned before any file processing occurs.

**Cleanup on failure**: If any file upload or candidate creation fails mid-batch, already-created candidate records are deleted from the database (lines 329–337 of `jobController.ts`). Note: already-uploaded files in object storage are **not** cleaned up — this is a known limitation.

---

### 2.2 Object Storage

**What happens**: Each validated file buffer is uploaded to an S3-compatible object storage bucket. The returned public URL is stored on the `Candidate.rawFileUrl` column.

**Responsible files**:
- `src/lib/storage.ts` — `uploadFile()`, `downloadFile()`, and `deleteFile()` functions

**Input**: `Buffer` (file content), `string` (unique filename), `string` (MIME type).

**Output**: `string` — the public URL of the stored file, e.g. `http://localhost:9000/cv-files/jobs/{jobId}/{timestamp}-{random}.pdf`

**Storage key structure**: Files are stored under `jobs/{jobOpeningId}/{timestamp}-{random}.{extension}`, ensuring unique keys and logical grouping per job.

**Libraries used**:
- **@aws-sdk/client-s3** (`^3.1072.0`) — Official AWS S3 client. Works with any S3-compatible provider (Cloudflare R2, MinIO, AWS S3). Chosen for broad compatibility and first-party support.

**S3 client configuration** (from `storage.ts`):
- `region: "auto"` — R2 doesn't require a specific region
- `forcePathStyle: true` — required for MinIO and R2 compatibility
- Credentials read from `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY` environment variables

**URL construction**: The public URL is built as `{STORAGE_PUBLIC_URL || STORAGE_ENDPOINT}/{STORAGE_BUCKET}/{key}`. When using Cloudflare R2, `STORAGE_PUBLIC_URL` should be set to the R2.dev domain (the S3 API endpoint requires auth and cannot be used as a public URL).

**Error handling**: All operations throw `AppError` with descriptive codes:
- `STORAGE_UPLOAD_FAILED` (500) — upload failure
- `STORAGE_DOWNLOAD_FAILED` (500) — download failure
- `STORAGE_DELETE_FAILED` (500) — deletion failure
- `STORAGE_INVALID_URL` (400) — URL doesn't match expected prefix
- `STORAGE_EMPTY_BODY` (500) — empty response from storage

**Known limitations**:
- No file integrity verification (checksum/hash) after upload
- No automatic cleanup of orphaned files when candidate creation fails after upload

---

### 2.3 Queue Architecture

**What happens**: After each candidate record is created with a `rawFileUrl`, a parsing job is enqueued into the `cv-parsing` BullMQ queue. When all parsing for a job opening completes, scoring jobs are enqueued into the `cv-scoring` queue. Both queues use Redis as the backing store.

**Responsible files**:
- `src/lib/queue.ts` — queue definitions and Redis connection config
- `src/lib/redis.ts` — singleton ioredis client
- `src/app.ts` — BullMQ Board UI setup (lines 70–82)

**Queue definitions**:

| Queue Name | Purpose | Job Name | Triggered By |
|------------|---------|----------|--------------|
| `cv-parsing` | Text extraction + LLM parsing | `parse-cv` | `uploadCandidates` controller |
| `cv-scoring` | LLM scoring + enrichment | `score-cv` | `enqueueScoringIfJobOpeningComplete()` in parser worker |

**Retry configuration** (identical for both queues):
- **Attempts**: 3
- **Backoff**: Exponential, starting at 2000 ms (2s → 4s → 8s)

**Job ID strategy**: Each job uses a deterministic ID (`parse-cv-{candidateId}` / `score-cv-{candidateId}`), ensuring idempotency — if the same job is enqueued twice (e.g. due to a race condition when two parsing jobs complete simultaneously), BullMQ silently ignores the duplicate.

**Queue transition logic** (`enqueueScoringIfJobOpeningComplete` in `cvParser.worker.ts`, line 169):
1. After a candidate reaches a terminal parsing state (`SCORED` or `FAILED`), query the database for remaining `PENDING` candidates in the same job opening.
2. If `remainingPending > 0`, do nothing — wait for other parsing jobs to finish.
3. If `remainingPending === 0`, query all `SCORED` candidates and enqueue one `score-cv` job per candidate.
4. Also trigger notification creation for the team (parsing completed / failed notification).

**Redis dependency**: Both BullMQ and the direct ioredis client connect via `REDIS_URL` (default: `redis://localhost:6379`). The connection config extracts `host` and `port` from the URL.

**BullMQ Board** (development only):
- Available at `http://localhost:3001/admin/queues`
- Shows both `cv-parsing` and `cv-scoring` queues
- Allows inspection of active, waiting, completed, and failed jobs
- Enabled only when `NODE_ENV=development` (see `src/app.ts` line 71)
- Uses `@bull-board/express` (`^8.0.1`)

---

### 2.4 Text Extraction

**What happens**: The worker downloads the file from object storage, determines its format from the URL extension, and extracts raw text using the appropriate library.

**Responsible files**:
- `src/workers/cvParser.worker.ts` — `extractText()` function (line 55)

**Two extraction paths**:

| Format | Library | How it works |
|--------|---------|-------------|
| PDF | `pdf-parse` (`^2.4.5`) | Instantiates `PDFParse` with the file buffer, calls `getText()`, returns `{ text }`. The parser instance is explicitly destroyed after extraction (`parser.destroy()`). |
| DOCX | `mammoth` (`^1.12.0`) | Calls `mammoth.extractRawText({ buffer })`, returns `{ value }` containing the plain text. |

**Format detection**: Based on URL extension — if the URL contains `.docx` (case-insensitive), mammoth is used; otherwise pdf-parse is assumed (line 56–58).

**Input**: `Buffer` (raw file bytes) + `string` (file URL for format detection).

**Output**: `string` — raw extracted text.

**Pre-processing / cleaning**: The raw text is **truncated** to a maximum of **5,000 characters** (`MAX_CV_CHARS`, line 23) before being sent to the LLM. This truncation exists to prevent timeouts and excessive token consumption on smaller local models. The truncation happens inside the prompt construction function (`CV_EXTRACTION_PROMPT`, line 30).

**Known limitations**:

1. **Multi-column PDF layouts produce garbled text**: `pdf-parse` reads text in stream order (left-to-right, top-to-bottom), which causes columns to interleave. Skills and work experience sections are frequently lost or mixed with adjacent columns. This is the most impactful known issue in the pipeline.

2. **No text length threshold check**: There is no explicit check for suspiciously short extracted text (e.g. scanned image PDFs that produce zero or near-zero text). If the text is empty or very short, it proceeds to the LLM which will return mostly `null` fields — the candidate row is created with minimal data but no error is surfaced.

3. **Hard truncation at 5,000 characters**: For CVs longer than approximately 1,500 words, later sections (typically skills, languages, certifications) are silently dropped. This is especially problematic with local models that have smaller context windows.

---

### 2.5 LLM Abstraction Layer

**What happens**: A unified `callLLM(prompt, systemPrompt)` function routes LLM requests to either a cloud provider or a local Ollama instance, based solely on the `LLM_PROVIDER` environment variable. No code changes are needed when switching.

**Responsible files**:
- `src/lib/llm.ts` — the complete abstraction layer (105 lines)

**Function signature**:
```typescript
export async function callLLM(prompt: string, systemPrompt: string): Promise<string>
```

**Routing logic**:
1. Read `LLM_PROVIDER` from environment (defaults to `"local"` if not set).
2. If `"cloud"` → call `callCloud()`.
3. Otherwise → call `callLocal()`.

**Cloud mode** (`LLM_PROVIDER=cloud`):
- Sends a POST request to `{LLM_API_URL}/chat/completions` using the OpenAI chat completions format.
- Includes `Authorization: Bearer {LLM_API_KEY}` header.
- Supports any OpenAI-compatible API: OpenAI, Mistral, Anthropic (via proxy).
- `temperature: 0` for deterministic output.
- Request timeout: 360 seconds (6 minutes).
- Required env vars: `LLM_API_URL`, `LLM_MODEL`, `LLM_API_KEY`.
- Throws `Error` if any required variable is missing.

**Local mode** (`LLM_PROVIDER=local`):
- Sends a POST request to `{LLM_LOCAL_URL}/v1/chat/completions` (Ollama's OpenAI-compatible endpoint).
- No authentication header required.
- `temperature: 0` for deterministic output.
- Request timeout: 360 seconds (6 minutes).
- Default values: `LLM_LOCAL_URL` = `http://localhost:11434`, `LLM_LOCAL_MODEL` = `llama3`.
- No env vars are strictly required (all have defaults).

**Request body format** (identical for both modes):
```json
{
  "model": "<model_name>",
  "messages": [
    { "role": "system", "content": "<systemPrompt>" },
    { "role": "user", "content": "<prompt>" }
  ],
  "temperature": 0
}
```

**Response parsing**: Both modes extract `response.data.choices[0].message.content`. If the content is empty or undefined, an `Error` is thrown (`"Empty response from cloud/local LLM."`).

**Libraries used**:
- **axios** (`^1.18.0`) — HTTP client for LLM API calls. Chosen for its straightforward API, timeout support, and wide adoption.

**How to switch providers**: Edit `.env`, change `LLM_PROVIDER` from `local` to `cloud` (or vice versa), set the corresponding environment variables, restart the server. No code changes are needed.

**Environment variables reference for this stage**:

| Variable | Mode | Required | Default | Purpose |
|----------|------|----------|---------|---------|
| `LLM_PROVIDER` | Both | No | `local` | Selects cloud or local routing |
| `LLM_API_URL` | Cloud | Yes | — | Base URL for cloud API (e.g. `https://api.mistral.ai/v1`) |
| `LLM_MODEL` | Cloud | Yes | — | Model name (e.g. `mistral-small-latest`, `gpt-4o-mini`) |
| `LLM_API_KEY` | Cloud | Yes | — | API authentication token |
| `LLM_LOCAL_URL` | Local | No | `http://localhost:11434` | Ollama server URL |
| `LLM_LOCAL_MODEL` | Local | No | `llama3` | Ollama model name (e.g. `llama3.1:8b`) |

> **Note**: The current implementation does **not** use Ollama's `format: "json"` flag. JSON output is enforced purely through prompt engineering (asking the model to return only a JSON object). This works reliably with larger models but can fail with smaller local models that include markdown formatting in their responses.

---

### 2.6 CV Parsing — LLM Extraction

**What happens**: The extracted raw text is sent to the LLM with a structured extraction prompt. The LLM returns a JSON object with the candidate's structured data. This JSON is validated, then persisted to the database.

**Responsible files**:
- `src/workers/cvParser.worker.ts` — `processCvJob()` function (line 80), prompt definitions (lines 25–53), `extractJsonFromResponse()` helper (line 71)

**System prompt** (line 25–27):
> *"You are a CV parsing assistant. Extract structured information from the provided CV text. Return ONLY a valid JSON object with no markdown, no code blocks, no extra text. Use null for any field you cannot find — never hallucinate or invent data."*

**Extraction prompt structure**: Includes instructions for name extraction (handling ALL CAPS names, single-name candidates), then specifies the expected JSON schema with field types.

**Extracted fields**:

| Field | Type | Description | Null policy |
|-------|------|-------------|-------------|
| `firstName` | `string \| null` | Given name | null if not found |
| `lastName` | `string \| null` | Family name / surname | null if not found |
| `email` | `string \| null` | Email address | null if not found |
| `phone` | `string \| null` | Phone number | null if not found |
| `summary` | `string \| null` | Professional summary | null if not found |
| `workExperience` | `Array<{ company, title, startDate, endDate, description }> \| null` | Work history | null if not found |
| `education` | `Array<{ institution, degree, field, startDate, endDate }> \| null` | Education history | null if not found |
| `skills` | `string[] \| null` | List of skills | null if not found |
| `languages` | `Array<{ language, level }> \| null` | Spoken languages | null if not found |

**JSON validation** (`extractJsonFromResponse`, line 71–78):
1. Scan the raw LLM response for the first `{` and last `}`.
2. Extract the substring between those delimiters.
3. Parse with `JSON.parse()`.
4. If no `{` or `}` is found, or parsing fails, throw `Error("No JSON object found in LLM response")` — this triggers a retry.

> **Note**: There is no strict schema validation beyond JSON parsing. Missing fields are not rejected — the JSON is accepted as-is and stored. The database accepts `Json?` (nullable JSON) so partial results are tolerated.

**Database writes on success** (line 101–110):
- `parsedJson` ← the full parsed JSON object
- `status` ← `CandidateStatus.SCORED`
- `firstName` ← from parsed data (if string)
- `lastName` ← from parsed data (if string)
- `email` ← from parsed data (if string)

**Database writes on failure** (line 207–210):
- After the final retry attempt (3rd failure), `status` is set to `CandidateStatus.FAILED`.
- `parsedJson` remains `null`.

**Retry behaviour**:
- Up to 3 attempts total (configured via queue defaults).
- On each failed attempt (except the last), the error is re-thrown to trigger BullMQ's exponential backoff.
- On the last attempt, the candidate is marked `FAILED` and the scoring transition check runs (so that a single failed CV doesn't block scoring for the entire job opening).

---

### 2.7 Candidate Scoring — LLM Scoring Engine

**What happens**: For each successfully parsed candidate, the scoring worker sends the parsed CV data and the job's profile description to the LLM. The LLM returns a structured score with explanations. After scoring, enrichment runs automatically.

**Responsible files**:
- `src/workers/cvScorer.worker.ts` — `processScoringJob()` function (line 158), scoring prompts (lines 23–44), validation logic (lines 135–156)

**Inputs to the scoring prompt**:
1. `profileDescription` — the full text of the job profile (from `JobOpening.profileDescription`)
2. `parsedJson` — the candidate's structured extraction result (serialized as formatted JSON)

**System prompt** (line 23–27):
> *"You are an expert technical recruiter scoring a candidate against a job profile. Read the job profile description and the candidate's structured CV data, then evaluate the fit. Return ONLY a valid JSON object with no markdown, no code blocks, no extra text. Never hallucinate or invent information that is not present in the candidate data — if a criterion from the job profile cannot be determined from the CV data, it must be listed in "missingCriteria", not assumed."*

**Scoring output fields**:

| Field | Type | Description |
|-------|------|-------------|
| `score` | `number` (0–100) | Overall fit score, rounded to integer |
| `matchedCriteria` | `string[]` | Job profile criteria the candidate satisfies |
| `missingCriteria` | `string[]` | Criteria not satisfied or not confirmable from CV |
| `strengths` | `string[]` | Notable positives, even if not explicitly required |
| `verdict` | `string` | One of: `STRONG_FIT`, `GOOD_FIT`, `PARTIAL_FIT`, `WEAK_FIT` |

**Verdict scale**: The verdict is determined entirely by the LLM — there is no hard-coded score-to-verdict mapping in the codebase. The prompt asks the LLM to assign one of the four verdicts. Validation (line 145) checks that the returned verdict is one of the four valid values.

**Validation** (`validateScoringResult`, line 135–156):
1. Score must be a finite number between 0 and 100 (rounded to integer).
2. `matchedCriteria`, `missingCriteria`, and `strengths` must be arrays.
3. `verdict` must be one of `STRONG_FIT`, `GOOD_FIT`, `PARTIAL_FIT`, `WEAK_FIT`.
4. Any validation failure throws an error, triggering a retry.

**Database writes on success** (line 182–189):
- `score` ← the integer score (0–100)
- `scoreExplanation` ← the full scoring result object (score, matchedCriteria, missingCriteria, strengths, verdict)
- `status` ← `CandidateStatus.SCORED` (unchanged, already set by parsing)

**Database writes on failure** (line 294–303):
- Score and scoreExplanation remain `null`.
- Status is **not** changed to `FAILED` — parsing already succeeded, so the candidate keeps `SCORED` status.
- The error is logged to console but does not affect the candidate's data.

**Trigger mechanism**: The scoring queue is populated by the parsing worker, not directly by the API. The `enqueueScoringIfJobOpeningComplete()` function (line 169 in `cvParser.worker.ts`) checks if all candidates for a job opening have reached a terminal parsing state (`SCORED` or `FAILED`). Only when no `PENDING` candidates remain are scoring jobs enqueued for all `SCORED` candidates.

---

### 2.8 Summary and Interview Question Generation

**What happens**: Immediately after scoring succeeds, the enrichment phase runs as part of the same scoring worker. Two independent LLM calls execute in parallel: one generates a role-specific summary, the other generates tailored interview questions. Failures are non-blocking.

**Responsible files**:
- `src/workers/cvScorer.worker.ts` — `enrichCandidate()` function (line 207), `generateSummary()` (line 256), `generateInterviewQuestions()` (line 272), prompt definitions (lines 48–93)

> **Important**: Despite the ticket description mentioning a separate `cv-enrichment` queue, enrichment currently runs **inline** within the scoring worker (called directly after `processScoringJob` succeeds at line 194). There is no separate enrichment queue in the current codebase.

#### Summary generation

**Inputs**: `profileDescription` + `parsedJson` (same as scoring).

**System prompt**: *"You are a professional talent advisor writing concise candidate summaries for hiring teams. Return ONLY the summary text — no markdown, no headings, no bullet points. Just a plain paragraph."*

**User prompt**: Asks for a 4–6 sentence professional summary targeted at the specific job, highlighting relevant experience, skills, and qualifications. Explicitly instructs that this is **not** a generic bio — it must speak to the candidate's fit for the specific role. Notable gaps should be mentioned briefly.

**Output**: A plain text string (no JSON). Validated only for emptiness — if the LLM returns an empty string, an error is thrown.

**What a good summary looks like**: A targeted paragraph that names the role, highlights 2–3 directly relevant qualifications, mentions the candidate's years of experience in the field, and briefly notes any gaps (e.g., "lacks formal experience with X but has adjacent experience in Y").

**What a poor summary looks like**: A generic bio that could apply to any role, or a summary that repeats the CV verbatim without relating it to the job profile.

#### Interview question generation

**Inputs**: `profileDescription`, `parsedJson`, `missingCriteria` (from scoring), `strengths` (from scoring).

**System prompt**: *"You are a senior technical interviewer designing targeted interview questions. Return ONLY a valid JSON array with no markdown, no code blocks, no extra text."*

**Question structure — exactly 7 questions**:

| Questions | Type | Purpose |
|-----------|------|---------|
| 1–3 | Gap questions | Probe `missingCriteria` — explore whether the candidate has hidden experience or can compensate |
| 4–5 | Strength validation | Dig deeper into claimed `strengths` to verify depth of expertise |
| 6–7 | Behavioural questions | STAR-format questions about past situations relevant to the role |

**Each question object**:
```json
{
  "question": "string — the interview question",
  "rationale": "string — one sentence explaining why this question is being asked"
}
```

**Validation** (`validateInterviewQuestions`, line 109–124):
1. Must be exactly 7 items (strict count check).
2. Each item must have a non-empty `question` string and a non-empty `rationale` string.
3. Validation failure throws an error.

**JSON extraction**: Uses `extractJsonArrayFromResponse()` (line 100) which finds the first `[` and last `]` in the LLM response and parses the substring.

#### Enrichment failure behaviour

Both LLM calls run concurrently via `Promise.allSettled()` (line 215). Each call is independent:
- If the summary succeeds but interview questions fail → only `summary` is written to DB.
- If interview questions succeed but summary fails → only `interviewQuestions` is written to DB.
- If both fail → no DB update occurs.
- **Failures are logged but never thrown** — the candidate's score and status are preserved regardless.

**Database writes** (line 248–253):
- `summary` ← plain text summary (if generation succeeded)
- `interviewQuestions` ← JSON array of 7 `{ question, rationale }` objects (if generation succeeded)

---

## 3. Data Model — Pipeline-Relevant Fields

### Candidate — pipeline fields

| Field | Type | Set at Stage | Notes |
|-------|------|-------------|-------|
| `id` | `String` (cuid) | Upload | Auto-generated primary key |
| `rawFileUrl` | `String` | Upload | Public URL to the stored file in object storage |
| `status` | `CandidateStatus` enum | Upload → Parsing | `PENDING` → `SCORED` (on parse success) or `FAILED` (on parse failure). Can also be manually set to `SHORTLISTED` / `REJECTED` by recruiter |
| `parsedJson` | `Json?` | Parsing | Full structured extraction result (see §2.6 field table). `null` until parsing succeeds |
| `firstName` | `String?` | Upload → Parsing | Set to empty string at upload, overwritten with parsed value on success |
| `lastName` | `String?` | Upload → Parsing | Same as firstName |
| `email` | `String?` | Upload → Parsing | Same as firstName |
| `score` | `Int?` | Scoring | Integer 0–100. `null` until scoring succeeds |
| `scoreExplanation` | `Json?` | Scoring | `{ score, matchedCriteria[], missingCriteria[], strengths[], verdict }`. `null` until scoring succeeds |
| `summary` | `String?` | Enrichment | AI-generated role-specific plain text summary. `null` if enrichment fails or hasn't run |
| `interviewQuestions` | `Json?` | Enrichment | Array of 7 `{ question, rationale }` objects. `null` if enrichment fails or hasn't run |
| `jobOpeningId` | `String` | Upload | Foreign key to `JobOpening` |
| `createdAt` | `DateTime` | Upload | Auto-set on creation |
| `updatedAt` | `DateTime` | Every update | Auto-updated by Prisma |

### CandidateStatus enum

| Value | Meaning |
|-------|---------|
| `PENDING` | Uploaded, awaiting parsing |
| `SCORED` | Parsing succeeded (and possibly scoring too) |
| `FAILED` | Parsing failed after all retries |
| `NEW` | Available for manual recruiter workflow |
| `SHORTLISTED` | Manually shortlisted by recruiter |
| `REJECTED` | Manually rejected by recruiter |
| `OFFERED` | Offer stage |

### JobOpening — pipeline-relevant fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String` (cuid) | Referenced by candidates |
| `title` | `String` | Used in notifications |
| `profileDescription` | `String` | Fed into scoring and enrichment prompts as the job profile |
| `organisationId` | `String` | Used for team notifications on completion |

---

## 4. Environment Variables Reference

| Variable | Purpose | Stage | Required | Example |
|----------|---------|-------|----------|---------|
| `LLM_PROVIDER` | Selects `cloud` or `local` LLM mode | All LLM calls | No (default: `local`) | `cloud` or `local` |
| `LLM_API_URL` | Base URL for cloud LLM API | Parsing, Scoring, Enrichment | Cloud only | `https://api.mistral.ai/v1` |
| `LLM_MODEL` | Model name for cloud provider | Parsing, Scoring, Enrichment | Cloud only | `mistral-small-latest` |
| `LLM_API_KEY` | API token for cloud provider | Parsing, Scoring, Enrichment | Cloud only | `sk-...` |
| `LLM_LOCAL_URL` | Base URL for local Ollama instance | Parsing, Scoring, Enrichment | No (default: `http://localhost:11434`) | `http://localhost:11434` |
| `LLM_LOCAL_MODEL` | Model name for Ollama | Parsing, Scoring, Enrichment | No (default: `llama3`) | `llama3.1:8b` |
| `REDIS_URL` | Redis connection for BullMQ queues | Queue (parsing + scoring) | No (default: `redis://localhost:6379`) | `redis://localhost:6379` |
| `STORAGE_ENDPOINT` | S3-compatible storage API endpoint | Upload, Download | Yes | `http://localhost:9000` |
| `STORAGE_BUCKET` | Storage bucket name | Upload, Download | Yes | `cv-files` |
| `STORAGE_ACCESS_KEY` | Storage access key ID | Upload, Download | Yes | `minioadmin` |
| `STORAGE_SECRET_KEY` | Storage secret access key | Upload, Download | Yes | `minioadmin` |
| `STORAGE_PUBLIC_URL` | Public-facing URL base (if different from endpoint) | Upload (URL construction) | No (defaults to `STORAGE_ENDPOINT`) | `https://pub-xxxx.r2.dev` |
| `DATABASE_URL` | PostgreSQL connection string | All DB operations | Yes | `postgresql://user:pass@localhost:5432/linkup_dev` |

---

## 5. Known Limitations and Open Issues

### 1. Multi-column PDF layout causes garbled text extraction

**Condition**: CVs designed with two-column layouts, multi-column tables, or complex PDF formatting (common in designer-crafted CV templates).

**Impact**: **High** — skills and work experience sections are frequently lost entirely or interleaved with content from adjacent columns. The LLM receives garbled text and either produces a mostly-null extraction or confidently extracts incorrect data.

**Recommended fix**: Replace `pdf-parse` with `pdfjs-dist` which is layout-aware and handles multi-column documents correctly. Alternatively, consider a dedicated document parsing service (e.g. Apache Tika, or a cloud OCR API).

**Priority**: High

---

### 2. Local LLM drops fields on long CVs

**Condition**: CVs longer than approximately 1,500 words, combined with the 5,000-character hard truncation (`MAX_CV_CHARS`) and a local model with an 8k context window.

**Impact**: **Medium** — later sections of the CV (typically skills, languages, and certifications listed at the bottom) are silently ignored because the text is truncated before reaching the LLM.

**Recommended fix**: Implement text chunking with overlap before sending to the LLM, or increase `MAX_CV_CHARS` for cloud models that support larger context windows. Consider splitting extraction into multiple focused calls (one for personal info, one for experience, one for skills).

**Priority**: High

---

### 3. No JSON mode enforcement for LLM responses

**Condition**: When using smaller local models (e.g. `llama3.2:1b` or `llama3.2:3b`), the LLM sometimes wraps its JSON response in markdown code blocks (` ```json ... ``` `) or includes explanatory text before/after the JSON.

**Impact**: **Medium** — the `extractJsonFromResponse()` helper strips surrounding text by finding `{` / `}` delimiters, so markdown wrapping is usually handled. However, edge cases (e.g. the model adds a second JSON object as an "example") can cause parsing failures and retries, slowing down the pipeline.

**Recommended fix**: Use Ollama's `format: "json"` parameter in the request body when `LLM_PROVIDER=local`. For cloud providers, use OpenAI's `response_format: { type: "json_object" }` or Mistral's equivalent.

**Priority**: Medium

---

### 4. No explicit check for empty or near-empty text extraction

**Condition**: Scanned/image-based PDFs, encrypted PDFs, or corrupt files that produce zero or near-zero text after extraction.

**Impact**: **Medium** — the LLM receives an empty or very short prompt and returns mostly null fields. The candidate is marked as `SCORED` (not `FAILED`) with a parsedJson full of null values, which can be confusing to recruiters who see a "scored" candidate with no data.

**Recommended fix**: Add a minimum text length threshold (e.g. 50 characters). If extracted text is shorter, mark the candidate as `FAILED` with a descriptive error message, and suggest the recruiter re-upload a text-based version.

**Priority**: Medium

---

### 5. Verdict scale is not deterministic

**Condition**: The LLM assigns the verdict string (`STRONG_FIT`, `GOOD_FIT`, `PARTIAL_FIT`, `WEAK_FIT`) without hard-coded score boundaries. Two candidates with the same score might receive different verdicts across different model versions or providers.

**Impact**: **Low** — the verdict is used as a secondary label alongside the numeric score. Inconsistencies are rarely noticed unless candidates are compared side-by-side.

**Recommended fix**: Define explicit score ranges for each verdict in code (e.g. 80–100 = `STRONG_FIT`, 60–79 = `GOOD_FIT`, etc.) and override the LLM's verdict with the code-determined one.

**Priority**: Low

---

### 6. No orphaned file cleanup on partial upload failure

**Condition**: When uploading a batch of files, if the 5th file out of 10 fails to create a candidate record, files 1–4 have already been uploaded to object storage. The controller cleans up database records but not stored files.

**Impact**: **Low** — orphaned files consume storage space but do not affect functionality. In practice, individual file uploads rarely fail after passing validation.

**Recommended fix**: Track uploaded file keys during the batch loop and delete them from storage in the catch block.

**Priority**: Low

---

### 7. Enrichment has no separate retry mechanism

**Condition**: If the summary or interview question LLM call fails (network timeout, malformed response), there is no mechanism to retry enrichment independently. The scoring worker does not re-throw enrichment errors.

**Impact**: **Medium** — candidates can end up with a score but no summary and no interview questions. There is no way for the recruiter to trigger a re-enrichment from the UI.

**Recommended fix**: Implement a separate `cv-enrichment` queue (as originally planned in the architecture) that can be retried independently of scoring. Alternatively, add a "retry enrichment" button in the frontend.

**Priority**: Medium

---

### 8. Single-threaded worker processing

**Condition**: Both the parsing and scoring workers run as single-instance workers inside the same Node.js process (started in `src/index.ts`). Under high load (e.g. 100 CVs uploaded simultaneously), jobs are processed sequentially.

**Impact**: **Low to Medium** — for typical usage (10–30 CVs per job opening), sequential processing is acceptable. For large batch uploads (100 CVs), the queue can take a long time to drain, especially with local LLMs.

**Recommended fix**: Configure BullMQ worker concurrency (e.g. `{ concurrency: 3 }`) or run workers as separate processes that can be scaled independently.

**Priority**: Low

---

## 6. How to Run and Debug the Pipeline Locally

### Step 1 — Start infrastructure services

Start PostgreSQL, Redis, and MinIO using Docker Compose:

```bash
cd back/Saas_backEnd
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5433` (mapped to internal `5432`)
- **Redis** on port `6379`
- **MinIO** (S3-compatible storage) on port `9000` (API) and `9001` (web UI)
- **minio-init** — a one-shot container that creates the `cv-files` bucket automatically

Verify all services are running:
```bash
docker compose ps
```

### Step 2 — Configure environment

Ensure `apps/api/.env` has the correct values (the defaults should work for local development):

```env
LLM_PROVIDER=local
LLM_LOCAL_URL=http://localhost:11434
LLM_LOCAL_MODEL=llama3.1:8b
REDIS_URL=redis://localhost:6379
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET=cv-files
DATABASE_URL=postgresql://postgres:password@localhost:5433/linkup_dev
```

### Step 3 — Start Ollama (if using local LLM)

```bash
# Install the model (first time only)
ollama pull llama3.1:8b

# Start the server
ollama serve
```

To use the cloud LLM instead, set `LLM_PROVIDER=cloud` and configure `LLM_API_URL`, `LLM_MODEL`, `LLM_API_KEY`.

### Step 4 — Run database migrations

```bash
cd apps/api
npx prisma migrate dev
npx prisma db seed    # Creates the initial organisation and admin account
```

### Step 5 — Start the API server (includes workers)

```bash
npm run dev
```

The API server and both workers (parsing + scoring) start in the same process. You should see:

```
✅ Redis queue configured at localhost:6379
🚀 CV parsing worker started on queue "cv-parsing"
🚀 CV scoring worker started on queue "cv-scoring"
🛠  BullMQ Board → http://localhost:3001/admin/queues
✅ Server running on port 3001 (development)
```

### Step 6 — Open the BullMQ Board

Navigate to **http://localhost:3001/admin/queues** in your browser.

**What to look for**:
- **Waiting**: jobs in the queue waiting to be picked up
- **Active**: jobs currently being processed
- **Completed**: successfully finished jobs (click to see return data)
- **Failed**: jobs that failed all retries (click to see error stack traces)
- **Delayed**: jobs in exponential backoff waiting for retry

### Step 7 — Trigger a test run

Using cURL or Postman, first authenticate, then upload a PDF:

```bash
# 1. Login to get a JWT token
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@linkup.com","password":"admin123"}' \
  | jq -r '.data.accessToken')

# 2. Create a job opening (or use an existing one)
JOB_ID=$(curl -s -X POST http://localhost:3001/api/v1/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Job","profileDescription":"Looking for a senior Node.js developer with 5+ years experience"}' \
  | jq -r '.data.id')

# 3. Upload a CV
curl -X POST "http://localhost:3001/api/v1/jobs/${JOB_ID}/candidates/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@./sample-cv.pdf"
```

The response (HTTP 202) contains the created candidate IDs. The pipeline starts processing asynchronously.

### Step 8 — Check database state with Prisma Studio

```bash
npx prisma studio
```

Opens a web UI at **http://localhost:5555**. Navigate to the `Candidate` table and observe:
- **After upload**: `status = PENDING`, `rawFileUrl` is set, all other pipeline fields are `null`
- **After parsing**: `status = SCORED`, `parsedJson` is populated, `firstName`/`lastName`/`email` are set
- **After scoring**: `score` is set (0–100), `scoreExplanation` contains the full scoring result
- **After enrichment**: `summary` is set, `interviewQuestions` contains 7 objects

### Step 9 — Read worker logs

Worker logs are printed to the same terminal as the API server. Look for these emoji prefixes:

| Emoji | Meaning |
|-------|---------|
| 📥 | Parsing job started |
| ✅ | Step completed successfully |
| 📄 | Raw LLM response (useful for debugging prompt issues) |
| 🎯 | Scoring job started |
| 📝 | Enrichment started |
| ⚠️ | Enrichment partial failure (non-blocking) |
| ❌ | Job permanently failed |

**To identify which stage failed**: Failed jobs in the BullMQ Board show the full error stack trace. The error message indicates the stage:
- `"No JSON object found in LLM response"` → LLM returned non-JSON (parsing or scoring)
- `"Empty response from cloud/local LLM"` → LLM returned nothing (connectivity issue)
- `"Invalid score returned by LLM"` → Scoring validation failed
- `"Expected exactly 7 interview questions"` → Interview question generation failed
- `"STORAGE_DOWNLOAD_FAILED"` → Could not download file from object storage

### Step 10 — Retry a failed job from BullMQ Board

1. Open **http://localhost:3001/admin/queues**
2. Click on the queue (`cv-parsing` or `cv-scoring`)
3. Go to the **Failed** tab
4. Find the failed job and click **Retry**
5. The job will be re-enqueued and processed again

### Step 11 — Switch between cloud and local LLM

1. Edit `apps/api/.env`:
   ```env
   # Switch to cloud
   LLM_PROVIDER=cloud
   LLM_API_URL=https://api.mistral.ai/v1
   LLM_MODEL=mistral-small-latest
   LLM_API_KEY=your-api-key-here
   ```
2. Restart the dev server (`Ctrl+C`, then `npm run dev`).
3. Re-upload or retry a CV — the pipeline now uses the cloud LLM.
4. To switch back: set `LLM_PROVIDER=local` and restart.

---

## 7. Architecture Diagram

```mermaid
graph TB
    subgraph "Frontend"
        UI["Recruiter UI<br/>React"]
    end

    subgraph "API Server (Express)"
        UPLOAD["POST /api/v1/jobs/:jobId/candidates/upload<br/><i>jobController.ts</i>"]
        MULTER["Multer Middleware<br/><i>multer.ts</i>"]
        BOARD["BullMQ Board<br/>/admin/queues"]
    end

    subgraph "Object Storage (S3-compatible)"
        R2["MinIO / Cloudflare R2<br/><i>storage.ts</i>"]
    end

    subgraph "Redis"
        Q1["Queue: cv-parsing"]
        Q2["Queue: cv-scoring"]
    end

    subgraph "Workers (same process)"
        W1["CV Parsing Worker<br/><i>cvParser.worker.ts</i>"]
        W2["CV Scoring Worker<br/><i>cvScorer.worker.ts</i>"]
        ENRICH["Enrichment<br/>(inline in scorer)"]
    end

    subgraph "LLM Provider"
        LLM_CLOUD["Cloud API<br/>(Mistral / OpenAI)"]
        LLM_LOCAL["Local Ollama"]
    end

    subgraph "Database (PostgreSQL)"
        DB["Candidate table<br/><i>Prisma ORM</i>"]
    end

    UI -->|"multipart/form-data"| UPLOAD
    UPLOAD --> MULTER
    MULTER -->|"validated buffers"| R2
    R2 -->|"rawFileUrl"| DB
    UPLOAD -->|"enqueue parse-cv"| Q1
    Q1 --> W1
    W1 -->|"download file"| R2
    W1 -->|"callLLM()"| LLM_CLOUD
    W1 -->|"callLLM()"| LLM_LOCAL
    W1 -->|"parsedJson, status"| DB
    W1 -->|"enqueue score-cv<br/>(when all parsed)"| Q2
    Q2 --> W2
    W2 -->|"callLLM()"| LLM_CLOUD
    W2 -->|"callLLM()"| LLM_LOCAL
    W2 -->|"score, scoreExplanation"| DB
    W2 --> ENRICH
    ENRICH -->|"callLLM() × 2"| LLM_CLOUD
    ENRICH -->|"callLLM() × 2"| LLM_LOCAL
    ENRICH -->|"summary, interviewQuestions"| DB
    BOARD -.->|"inspect"| Q1
    BOARD -.->|"inspect"| Q2

    style UI fill:#4A90D9,color:#fff
    style R2 fill:#FF9500,color:#fff
    style Q1 fill:#E74C3C,color:#fff
    style Q2 fill:#E74C3C,color:#fff
    style DB fill:#27AE60,color:#fff
    style LLM_CLOUD fill:#9B59B6,color:#fff
    style LLM_LOCAL fill:#9B59B6,color:#fff
```

---

> **Maintainability note**: This document should be updated whenever the pipeline changes. Key areas to check: prompt text changes, new fields in `parsedJson` or `scoreExplanation`, new queues, new environment variables, and any changes to the retry configuration.
