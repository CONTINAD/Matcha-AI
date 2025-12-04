-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "actualSlippage" DOUBLE PRECISION,
ADD COLUMN     "executionQuality" DOUBLE PRECISION,
ADD COLUMN     "fillRate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT,
    "txHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "blockNumber" INTEGER,
    "gasUsed" TEXT,
    "gasPrice" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeAnalytics" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "expectedPrice" TEXT NOT NULL,
    "actualPrice" TEXT NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "fillRate" DOUBLE PRECISION NOT NULL,
    "executionTimeMs" INTEGER NOT NULL,
    "gasUsed" TEXT,
    "gasPrice" TEXT,
    "priceImpact" TEXT,
    "sellToken" TEXT NOT NULL,
    "buyToken" TEXT NOT NULL,
    "sellAmount" TEXT NOT NULL,
    "buyAmount" TEXT NOT NULL,

    CONSTRAINT "TradeAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_tradeId_key" ON "Transaction"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txHash_key" ON "Transaction"("txHash");

-- CreateIndex
CREATE INDEX "Transaction_txHash_idx" ON "Transaction"("txHash");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_chainId_idx" ON "Transaction"("chainId");

-- CreateIndex
CREATE INDEX "Transaction_submittedAt_idx" ON "Transaction"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAnalytics_tradeId_key" ON "TradeAnalytics"("tradeId");

-- CreateIndex
CREATE INDEX "TradeAnalytics_strategyId_idx" ON "TradeAnalytics"("strategyId");

-- CreateIndex
CREATE INDEX "TradeAnalytics_timestamp_idx" ON "TradeAnalytics"("timestamp");

-- CreateIndex
CREATE INDEX "TradeAnalytics_txHash_idx" ON "TradeAnalytics"("txHash");

-- CreateIndex
CREATE INDEX "TradeAnalytics_chainId_idx" ON "TradeAnalytics"("chainId");

-- CreateIndex
CREATE INDEX "Trade_txHash_idx" ON "Trade"("txHash");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAnalytics" ADD CONSTRAINT "TradeAnalytics_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
