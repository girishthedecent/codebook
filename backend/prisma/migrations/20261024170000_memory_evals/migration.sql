-- CreateEnum
CREATE TYPE "EvalCaseOrigin" AS ENUM ('MANUAL', 'SYNTHETIC', 'FAILURE');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('PROFILE', 'FACT');

-- AlterTable
ALTER TABLE "EvalCase" ADD COLUMN     "origin" "EvalCaseOrigin" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "EvalJudgeCache" (
    "key" TEXT NOT NULL,
    "judge" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalJudgeCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "sourceMessageId" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "lastUsedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- No vector index: recall reads one user's memories (hundreds at most) and sorts them
-- exactly. An HNSW index over every user's rows would be filtered by user after the
-- search and could return fewer than k.

-- CreateIndex
CREATE INDEX "Memory_userId_kind_deletedAt_idx" ON "Memory"("userId", "kind", "deletedAt");

-- CreateIndex
CREATE INDEX "Memory_sourceMessageId_idx" ON "Memory"("sourceMessageId");

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
