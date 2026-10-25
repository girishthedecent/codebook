-- AlterTable
ALTER TABLE "user" ADD COLUMN     "isAnonymous" BOOLEAN DEFAULT false;

-- CreateTable
CREATE TABLE "AnswerCache" (
    "key" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "model" TEXT,
    "promptId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AnswerCache_createdAt_idx" ON "AnswerCache"("createdAt");

-- AddForeignKey
ALTER TABLE "AnswerCache" ADD CONSTRAINT "AnswerCache_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
