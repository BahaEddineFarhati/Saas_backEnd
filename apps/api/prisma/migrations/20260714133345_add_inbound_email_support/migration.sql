/*
  Warnings:

  - A unique constraint covering the columns `[inboundEmail]` on the table `job_openings` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[inboundEmailCode]` on the table `job_openings` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "EmailIngestionStatus" AS ENUM ('PROCESSED', 'PARTIAL', 'REJECTED', 'JOB_NOT_FOUND', 'SPAM');

-- AlterTable
ALTER TABLE "job_openings" ADD COLUMN     "inboundEmail" TEXT,
ADD COLUMN     "inboundEmailCode" TEXT;

-- CreateTable
CREATE TABLE "email_ingestion_logs" (
    "id" TEXT NOT NULL,
    "jobOpeningId" TEXT,
    "senderEmail" TEXT NOT NULL,
    "subject" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "spamScore" DOUBLE PRECISION,
    "status" "EmailIngestionStatus" NOT NULL DEFAULT 'PROCESSED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_ingestion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_ingestion_logs_jobOpeningId_idx" ON "email_ingestion_logs"("jobOpeningId");

-- CreateIndex
CREATE INDEX "email_ingestion_logs_createdAt_idx" ON "email_ingestion_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_openings_inboundEmail_key" ON "job_openings"("inboundEmail");

-- CreateIndex
CREATE UNIQUE INDEX "job_openings_inboundEmailCode_key" ON "job_openings"("inboundEmailCode");

-- CreateIndex
CREATE INDEX "job_openings_inboundEmail_idx" ON "job_openings"("inboundEmail");

-- CreateIndex
CREATE INDEX "job_openings_inboundEmailCode_idx" ON "job_openings"("inboundEmailCode");

-- AddForeignKey
ALTER TABLE "email_ingestion_logs" ADD CONSTRAINT "email_ingestion_logs_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "job_openings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
