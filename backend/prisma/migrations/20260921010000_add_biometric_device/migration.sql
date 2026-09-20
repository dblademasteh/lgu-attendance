-- Change SyncLog.direction from the native SyncDirection enum to TEXT so an
-- outbound sync direction can be recorded without a non-transactional
-- `ALTER TYPE ... ADD VALUE` (Prisma migrate runs each migration in a txn).
ALTER TABLE "SyncLog" ALTER COLUMN "direction" TYPE TEXT USING "direction"::text;

-- Biometric device registry for the device-server integration.
CREATE TABLE "BiometricDevice" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "model" TEXT,
    "ip" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "lastSeenAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BiometricDevice_deviceId_key" UNIQUE ("deviceId"),
    CONSTRAINT "BiometricDevice_secretHash_key" UNIQUE ("secretHash")
);

CREATE INDEX "BiometricDevice_active_idx" ON "BiometricDevice"("active");
