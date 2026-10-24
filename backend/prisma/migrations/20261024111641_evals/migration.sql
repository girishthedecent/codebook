-- CreateEnum
CREATE TYPE "EvalCaseType" AS ENUM ('BOOK', 'CODE', 'MULTI_HOP', 'CROSS_SOURCE', 'NO_ANSWER');

-- CreateEnum
CREATE TYPE "EvalSplit" AS ENUM ('DEV', 'HELDOUT');

-- CreateEnum
CREATE TYPE "EvalRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "EvalDataset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "corpus" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalCase" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "expectedRefs" JSONB NOT NULL,
    "type" "EvalCaseType" NOT NULL,
    "split" "EvalSplit" NOT NULL,
    "tags" TEXT[],
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "gitSha" TEXT NOT NULL,
    "promptVersions" JSONB NOT NULL DEFAULT '[]',
    "models" JSONB NOT NULL DEFAULT '{}',
    "split" "EvalSplit" NOT NULL,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "costUsd" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "retrieved" JSONB NOT NULL DEFAULT '[]',
    "answer" TEXT,
    "citations" JSONB,
    "toolTrajectory" JSONB,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "latencyMs" INTEGER NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvalDataset_name_key" ON "EvalDataset"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EvalCase_datasetId_externalId_key" ON "EvalCase"("datasetId", "externalId");

-- CreateIndex
CREATE INDEX "EvalRun_suite_name_startedAt_idx" ON "EvalRun"("suite", "name", "startedAt");

-- CreateIndex
CREATE INDEX "EvalResult_caseId_idx" ON "EvalResult"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "EvalResult_runId_caseId_key" ON "EvalResult"("runId", "caseId");

-- AddForeignKey
ALTER TABLE "EvalCase" ADD CONSTRAINT "EvalCase_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "EvalDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "EvalDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "EvalCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
