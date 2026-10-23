-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('PDF', 'GITHUB_REPO', 'WEBSITE');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "IngestStage" AS ENUM ('QUEUED', 'FETCHING', 'FILTERING', 'PARSING', 'STRUCTURING', 'CHUNKING', 'CONTEXTUALIZING', 'EMBEDDING', 'INDEXING', 'DONE');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "IngestStage" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "origin" JSONB NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "contentHash" TEXT,
    "ingestVersion" INTEGER NOT NULL DEFAULT 0,
    "lastIngestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Source_workspaceId_createdAt_idx" ON "Source"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Source_workspaceId_dedupeKey_key" ON "Source"("workspaceId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
