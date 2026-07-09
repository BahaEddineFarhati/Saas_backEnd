-- AlterTable (idempotent)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "departureStatus" TEXT;
