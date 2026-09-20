-- AlterTable
ALTER TABLE "User" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");