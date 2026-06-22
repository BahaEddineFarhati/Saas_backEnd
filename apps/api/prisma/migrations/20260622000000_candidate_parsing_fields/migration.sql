-- Add PENDING, SCORED, FAILED values to CandidateStatus enum
ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'SCORED';
ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'FAILED';

-- Make candidate personal-info columns nullable (populated after LLM parsing)
ALTER TABLE "candidates" ALTER COLUMN "firstName" DROP NOT NULL;
ALTER TABLE "candidates" ALTER COLUMN "lastName" DROP NOT NULL;
ALTER TABLE "candidates" ALTER COLUMN "email" DROP NOT NULL;

-- Change default status from NEW to PENDING
ALTER TABLE "candidates" ALTER COLUMN "status" SET DEFAULT 'PENDING';
