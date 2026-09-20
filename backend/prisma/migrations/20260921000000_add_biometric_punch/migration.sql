-- Added BiometricPunch model for biometric.punch / biometric.punch_batch webhook
-- ingestion. AttendanceSource enum (and DEVICE) already exists, so no enum
-- migration is required; BiometricPunch.source reuses that type.
CREATE TABLE "BiometricPunch" (
    "id" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "eventTime" TIMESTAMPTZ NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'AUTO',
    "deviceRef" TEXT,
    "source" "AttendanceSource" NOT NULL DEFAULT 'DEVICE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiometricPunch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BiometricPunch_employeeNumber_date_idx" ON "BiometricPunch"("employeeNumber", "date");
CREATE INDEX "BiometricPunch_eventTime_idx" ON "BiometricPunch"("eventTime");
