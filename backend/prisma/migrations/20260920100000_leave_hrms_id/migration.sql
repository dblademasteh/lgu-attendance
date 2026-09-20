-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "hrmsId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_hrmsId_key" ON "LeaveRequest"("hrmsId");
