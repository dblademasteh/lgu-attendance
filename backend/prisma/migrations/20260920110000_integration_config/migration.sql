-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "hrmsBaseUrl" TEXT,
    "hrmsApiKeyEnc" TEXT,
    "hrmsWebhookSecretEnc" TEXT,
    "pollerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMin" INTEGER NOT NULL DEFAULT 15,
    "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "ingestPath" TEXT NOT NULL DEFAULT '/api/v1/attendance',
    "forwardingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);
