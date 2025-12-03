-- CreateTable
CREATE TABLE "CopyTarget" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "chainType" TEXT NOT NULL,
    "copyPercentage" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyTrade" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "originalTxHash" TEXT NOT NULL,
    "copiedTxHash" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "CopyTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopyTarget_strategyId_idx" ON "CopyTarget"("strategyId");

-- CreateIndex
CREATE INDEX "CopyTarget_status_idx" ON "CopyTarget"("status");

-- CreateIndex
CREATE INDEX "CopyTrade_targetId_idx" ON "CopyTrade"("targetId");

-- CreateIndex
CREATE INDEX "CopyTrade_status_idx" ON "CopyTrade"("status");

-- AddForeignKey
ALTER TABLE "CopyTarget" ADD CONSTRAINT "CopyTarget_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrade" ADD CONSTRAINT "CopyTrade_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "CopyTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
