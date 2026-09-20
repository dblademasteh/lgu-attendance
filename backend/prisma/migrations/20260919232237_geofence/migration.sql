-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "geoIn" JSONB,
ADD COLUMN     "geoOut" JSONB;

-- AlterTable
ALTER TABLE "AttendanceRule" ADD COLUMN     "geofenceRadiusM" DOUBLE PRECISION,
ADD COLUMN     "maxAccuracyM" DOUBLE PRECISION,
ADD COLUMN     "officeLat" DOUBLE PRECISION,
ADD COLUMN     "officeLng" DOUBLE PRECISION;


