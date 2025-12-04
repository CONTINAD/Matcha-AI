-- CreateTable
CREATE TABLE "ProfitabilityCheck" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sharpe" DOUBLE PRECISION,
    "avgReturn" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "maxDrawdown" DOUBLE PRECISION,
    "passed" BOOLEAN NOT NULL,
    "details" TEXT DEFAULT '{}',
    "message" TEXT,

    CONSTRAINT "ProfitabilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfitabilityCheck_strategyId_idx" ON "ProfitabilityCheck"("strategyId");

-- CreateIndex
CREATE INDEX "ProfitabilityCheck_timestamp_idx" ON "ProfitabilityCheck"("timestamp");

-- CreateIndex
CREATE INDEX "ProfitabilityCheck_passed_idx" ON "ProfitabilityCheck"("passed");

-- AddForeignKey
ALTER TABLE "ProfitabilityCheck" ADD CONSTRAINT "ProfitabilityCheck_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
