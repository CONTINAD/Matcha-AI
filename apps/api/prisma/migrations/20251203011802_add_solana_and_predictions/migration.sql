-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "symbol" TEXT NOT NULL,
    "predictedAction" TEXT NOT NULL,
    "predictedPrice" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "marketContext" TEXT NOT NULL DEFAULT '{}',
    "indicators" TEXT NOT NULL DEFAULT '{}',
    "reasoning" TEXT,
    "actualAction" TEXT,
    "actualPrice" DOUBLE PRECISION,
    "outcome" TEXT,
    "pnl" DOUBLE PRECISION,
    "tradeId" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "learningNotes" TEXT,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prediction_strategyId_idx" ON "Prediction"("strategyId");

-- CreateIndex
CREATE INDEX "Prediction_timestamp_idx" ON "Prediction"("timestamp");

-- CreateIndex
CREATE INDEX "Prediction_outcome_idx" ON "Prediction"("outcome");

-- CreateIndex
CREATE INDEX "Prediction_evaluatedAt_idx" ON "Prediction"("evaluatedAt");

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
