-- DropForeignKey
ALTER TABLE "invites" DROP CONSTRAINT IF EXISTS "invites_organisationId_fkey";
ALTER TABLE "invites" DROP CONSTRAINT IF EXISTS "invites_invitedById_fkey";

-- DropTable
DROP TABLE IF EXISTS "invites";

-- CreateTable
CREATE TABLE "invite_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_tokens_token_key" ON "invite_tokens"("token");

-- CreateIndex
CREATE INDEX "invite_tokens_email_idx" ON "invite_tokens"("email");

-- CreateIndex
CREATE INDEX "invite_tokens_organisationId_idx" ON "invite_tokens"("organisationId");

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
