-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "quarterlyRentalPeriod" VARCHAR(7),
ADD COLUMN     "quarterlyRentalSavedCents" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "orders_userId_quarterlyRentalPeriod_idx" ON "orders"("userId", "quarterlyRentalPeriod");

