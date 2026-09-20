-- AlterTable: ingestPath now stores the HRMS attendance-ingestion base
-- (POST <base>/punch|bulk|test), matching lgu-hrms /integrations/attendance.
ALTER TABLE "IntegrationConfig" ALTER COLUMN "ingestPath" SET DEFAULT '/integrations/attendance';
UPDATE "IntegrationConfig" SET "ingestPath" = '/integrations/attendance' WHERE "ingestPath" = '/api/v1/attendance';
