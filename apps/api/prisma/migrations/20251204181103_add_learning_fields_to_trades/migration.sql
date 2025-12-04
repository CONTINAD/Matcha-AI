-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "marketContextAtEntry" TEXT,
ADD COLUMN     "marketContextAtExit" TEXT,
ADD COLUMN     "predictionId" TEXT;

-- CreateIndex
CREATE INDEX "Trade_predictionId_idx" ON "Trade"("predictionId");
