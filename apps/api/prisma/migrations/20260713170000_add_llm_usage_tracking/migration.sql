-- CreateEnum
CREATE TYPE "LLMFeature" AS ENUM ('CV_PARSING', 'CV_SCORING', 'CV_ENRICHMENT', 'CHAT');

-- CreateTable
CREATE TABLE "llm_usage_logs" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" "LLMFeature" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage_summaries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "cvParsingTokens" INTEGER NOT NULL DEFAULT 0,
    "cvScoringTokens" INTEGER NOT NULL DEFAULT 0,
    "cvEnrichmentTokens" INTEGER NOT NULL DEFAULT 0,
    "chatTokens" INTEGER NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "llm_usage_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_usage_logs_organisationId_month_year_idx" ON "llm_usage_logs"("organisationId", "month", "year");

-- CreateIndex
CREATE INDEX "llm_usage_logs_userId_idx" ON "llm_usage_logs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "llm_usage_summaries_organisationId_month_year_key" ON "llm_usage_summaries"("organisationId", "month", "year");

-- AddForeignKey
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_usage_summaries" ADD CONSTRAINT "llm_usage_summaries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
