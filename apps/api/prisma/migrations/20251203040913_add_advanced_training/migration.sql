-- CreateTable
CREATE TABLE "ModelInsight" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "insight" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "action" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelInsight_strategyId_idx" ON "ModelInsight"("strategyId");

-- CreateIndex
CREATE INDEX "ModelInsight_createdAt_idx" ON "ModelInsight"("createdAt");

-- AddForeignKey
ALTER TABLE "ModelInsight" ADD CONSTRAINT "ModelInsight_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
