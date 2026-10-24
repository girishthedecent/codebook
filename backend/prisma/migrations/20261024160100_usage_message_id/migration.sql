-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "messageId" TEXT;

-- CreateIndex
CREATE INDEX "UsageEvent_messageId_idx" ON "UsageEvent"("messageId");
