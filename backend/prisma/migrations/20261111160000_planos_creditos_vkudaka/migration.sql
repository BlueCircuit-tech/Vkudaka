-- Planos e benefícios (2026-11-11): 100% da mensalidade vira crédito VKUDAKA
-- e o desconto fidelidade passa a valer na hora da compra.

ALTER TYPE "WalletTxType" ADD VALUE 'SUBSCRIPTION';

ALTER TABLE "plans" ADD COLUMN "compareAtPriceCents" INTEGER,
ADD COLUMN "promoLabel" VARCHAR(40),
ADD COLUMN "highlightLabel" VARCHAR(40);

ALTER TABLE "plan_benefits" ADD COLUMN "compareLabel" VARCHAR(60),
ADD COLUMN "compareValue" VARCHAR(20);

ALTER TABLE "plans" ALTER COLUMN "rebateMode" SET DEFAULT 'IMMEDIATE_DISCOUNT';
UPDATE "plans" SET "rebateMode" = 'IMMEDIATE_DISCOUNT';
