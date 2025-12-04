import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { paperTrader } from '../services/paperTrader';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const prisma = new PrismaClient();
const STRATEGY_ID = process.argv[2] || 'cmirqducl0001127mw8pxhkfq';

async function checkPaperTrading() {
  try {
    const strategy = await prisma.strategy.findUnique({
      where: { id: STRATEGY_ID },
      include: {
        trades: {
          where: { mode: 'PAPER' },
          orderBy: { timestamp: 'desc' },
          take: 5,
        },
      },
    });

    if (!strategy) {
      console.error(`❌ Strategy not found: ${STRATEGY_ID}`);
      process.exit(1);
    }

    console.log(`\n📊 Paper Trading Status for: ${strategy.name}\n`);
    console.log(`   Database Status: ${strategy.status}`);
    console.log(`   Mode: ${strategy.mode}`);
    console.log(`   In-Memory Active: ${paperTrader.isActive(STRATEGY_ID) ? '✅ YES' : '❌ NO'}`);

    const metrics = paperTrader.getTradingMetrics(STRATEGY_ID);
    if (metrics) {
      console.log(`\n📈 Trading Metrics:`);
      console.log(`   Total Decisions: ${metrics.totalDecisions}`);
      console.log(`   Trades Executed: ${metrics.tradesExecuted}`);
      console.log(`   Trades Blocked: ${metrics.tradesBlocked}`);
      console.log(`   Last Decision: ${metrics.lastDecisionTime ? new Date(metrics.lastDecisionTime).toLocaleString() : 'Never'}`);
      console.log(`   Last Trade: ${metrics.lastTradeTime ? new Date(metrics.lastTradeTime).toLocaleString() : 'Never'}`);
    }

    console.log(`\n📋 Recent Paper Trades: ${strategy.trades.length}`);
    strategy.trades.forEach((trade, i) => {
      console.log(`   ${i + 1}. ${trade.side} ${trade.symbol} @ $${trade.entryPrice.toFixed(2)} → PnL: ${trade.pnlPct.toFixed(2)}%`);
    });

    if (strategy.status === 'ACTIVE' && !paperTrader.isActive(STRATEGY_ID)) {
      console.log(`\n⚠️  Strategy is ACTIVE in database but not running in memory!`);
      console.log(`   This happens after server restart. Auto-start should handle this.`);
      console.log(`   You can manually start with: POST /strategies/${STRATEGY_ID}/paper/start\n`);
    } else if (strategy.status === 'ACTIVE' && paperTrader.isActive(STRATEGY_ID)) {
      console.log(`\n✅ Paper trading is ACTIVE and running!\n`);
    } else {
      console.log(`\n⏸️  Paper trading is PAUSED\n`);
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkPaperTrading();

