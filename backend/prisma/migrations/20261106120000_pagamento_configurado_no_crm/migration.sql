-- CreateTable
CREATE TABLE "payment_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'default',
    "provider" VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "acceptCard" BOOLEAN NOT NULL DEFAULT false,
    "publicKey" VARCHAR(120),
    "accessTokenEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "recipientName" VARCHAR(160),
    "recipientDocument" VARCHAR(14),
    "recipientPixKey" VARCHAR(120),
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);
