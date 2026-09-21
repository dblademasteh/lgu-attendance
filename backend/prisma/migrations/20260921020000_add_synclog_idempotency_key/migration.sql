-- idempotencyKey on SyncLog dedups OUTBOUND forwards to HRMS: a retry of the
-- same punch/correction/backfill after a transient failure must not double-send
-- (HRMS is the source of truth for its computed attendance). INBOUND/PULL rows
-- leave it NULL; Postgres allows multiple NULLs under the UNIQUE constraint.
ALTER TABLE "SyncLog" ADD COLUMN "idempotencyKey" VARCHAR(128);
CREATE UNIQUE INDEX "SyncLog_idempotencyKey_key" ON "SyncLog" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE INDEX "SyncLog_direction_createdAt_idx" ON "SyncLog" ("direction", "createdAt");
