-- gen_random_uuid() needs pgcrypto (postgres superuser can enable it).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'hrms',
    "baseUrl" TEXT,
    "apiKeyEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "webhookSlug" TEXT,
    "pollerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMin" INTEGER NOT NULL DEFAULT 15,
    "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "ingestBase" TEXT NOT NULL DEFAULT '/integrations/attendance',
    "forwardingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_webhookSlug_key" ON "Integration"("webhookSlug");
CREATE INDEX "Integration_isActive_idx" ON "Integration"("isActive");

-- Migrate the single-row HRMS config into the primary integration row.
INSERT INTO "Integration" (id, name, provider, "baseUrl", "apiKeyEnc", "webhookSecretEnc", "webhookSlug", "pollerEnabled", "intervalMin", "timeoutMs", "ingestBase", "forwardingEnabled", "isPrimary", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'LGU-HRMS', 'hrms', "hrmsBaseUrl", "hrmsApiKeyEnc", "hrmsWebhookSecretEnc", 'hrms', "pollerEnabled", "intervalMin", "timeoutMs", "ingestPath", "forwardingEnabled", true, true, "createdAt", "updatedAt"
FROM "IntegrationConfig" WHERE id = 'default';

-- AlterTable
ALTER TABLE "SyncLog" ADD COLUMN     "integrationId" TEXT;

-- CreateIndex
CREATE INDEX "SyncLog_integrationId_createdAt_idx" ON "SyncLog"("integrationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill legacy rows to the primary integration where possible.
UPDATE "SyncLog" SET "integrationId" = (SELECT id FROM "Integration" WHERE "isPrimary" = true LIMIT 1) WHERE "integrationId" IS NULL AND EXISTS (SELECT 1 FROM "Integration" WHERE "isPrimary" = true LIMIT 1);

-- DropTable
DROP TABLE "IntegrationConfig";
