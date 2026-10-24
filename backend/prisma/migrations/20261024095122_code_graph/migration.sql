-- CreateEnum
CREATE TYPE "SymbolKind" AS ENUM ('FILE', 'CLASS', 'INTERFACE', 'FUNCTION', 'METHOD');

-- CreateEnum
CREATE TYPE "EdgeType" AS ENUM ('IMPORTS', 'DEFINES', 'EXTENDS', 'IMPLEMENTS', 'CALLS');

-- AlterTable
ALTER TABLE "IngestDraft" ADD COLUMN     "graph" JSONB;

-- CreateTable
CREATE TABLE "CodeSymbol" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "kind" "SymbolKind" NOT NULL,
    "filePath" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER NOT NULL,
    "signature" TEXT,
    "exported" BOOLEAN NOT NULL,
    "chunkId" TEXT,

    CONSTRAINT "CodeSymbol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeEdge" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fromSymbolId" TEXT NOT NULL,
    "toSymbolId" TEXT,
    "toName" TEXT NOT NULL,
    "type" "EdgeType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "line" INTEGER NOT NULL,

    CONSTRAINT "CodeEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeSymbol_sourceId_name_idx" ON "CodeSymbol"("sourceId", "name");

-- CreateIndex
CREATE INDEX "CodeSymbol_documentId_idx" ON "CodeSymbol"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeSymbol_sourceId_qualifiedName_key" ON "CodeSymbol"("sourceId", "qualifiedName");

-- CreateIndex
CREATE INDEX "CodeEdge_sourceId_idx" ON "CodeEdge"("sourceId");

-- CreateIndex
CREATE INDEX "CodeEdge_fromSymbolId_type_idx" ON "CodeEdge"("fromSymbolId", "type");

-- CreateIndex
CREATE INDEX "CodeEdge_toSymbolId_type_idx" ON "CodeEdge"("toSymbolId", "type");

-- AddForeignKey
ALTER TABLE "CodeSymbol" ADD CONSTRAINT "CodeSymbol_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSymbol" ADD CONSTRAINT "CodeSymbol_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSymbol" ADD CONSTRAINT "CodeSymbol_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "SourceChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeEdge" ADD CONSTRAINT "CodeEdge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeEdge" ADD CONSTRAINT "CodeEdge_fromSymbolId_fkey" FOREIGN KEY ("fromSymbolId") REFERENCES "CodeSymbol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeEdge" ADD CONSTRAINT "CodeEdge_toSymbolId_fkey" FOREIGN KEY ("toSymbolId") REFERENCES "CodeSymbol"("id") ON DELETE SET NULL ON UPDATE CASCADE;
