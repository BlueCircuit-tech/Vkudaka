-- Valor promocional de venda da peça, com período opcional.
ALTER TABLE "products" ADD COLUMN "promoPriceCents" INTEGER,
ADD COLUMN "promoStartsAt" TIMESTAMP(3),
ADD COLUMN "promoEndsAt" TIMESTAMP(3);
