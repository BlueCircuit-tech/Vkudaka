-- CreateEnum
CREATE TYPE "PlanCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PlanCheckoutSource" AS ENUM ('APP', 'CRM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'DEBIT_CARD';
ALTER TYPE "PaymentMethod" ADD VALUE 'ACCOUNT_MONEY';

-- CreateTable
CREATE TABLE "plan_checkouts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "PlanCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "source" "PlanCheckoutSource" NOT NULL DEFAULT 'APP',
    "amountCents" INTEGER NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "preferenceId" VARCHAR(120),
    "checkoutUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentId" UUID,
    "subscriptionId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_checkouts_paymentId_key" ON "plan_checkouts"("paymentId");

-- CreateIndex
CREATE INDEX "plan_checkouts_userId_createdAt_idx" ON "plan_checkouts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "plan_checkouts_status_expiresAt_idx" ON "plan_checkouts"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "plan_checkouts" ADD CONSTRAINT "plan_checkouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_checkouts" ADD CONSTRAINT "plan_checkouts_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_checkouts" ADD CONSTRAINT "plan_checkouts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

