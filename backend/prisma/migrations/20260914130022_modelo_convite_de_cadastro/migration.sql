-- AlterTable
ALTER TABLE "model_profiles" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "inviteToken" VARCHAR(64),
ADD COLUMN     "invitedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "model_profiles_inviteToken_key" ON "model_profiles"("inviteToken");

