import 'dotenv/config';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

/**
 * Test script for paper trading
 * 
 * Usage:
 *   pnpm tsx apps/api/src/scripts/test-paper-trading.ts <strategyId>
 * 
 * Example:
 *   pnpm tsx apps/api/src/scripts/test-paper-trading.ts cmirqducl0001127mw8pxhkfq
 */

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: test-paper-trading.ts <strategyId>');
    console.error('Example: test-paper-trading.ts cmirqducl0001127mw8pxhkfq');
    process.exit(1);
  }

  const strategyId = args[0];

  logger.info({ strategyId }, 'Checking paper trading status');

  try {
    // Get strategy
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      select: {
        id: true,
        name: true,
        mode: true,
        status: true,
        chainId: true,
        baseAsset: true,
        universeJson: true,
        timeframe: true,
      },
    });

    if (!strategy) {
      console.error('❌ Strategy not found');
      process.exit(1);
    }

    console.log('\n=== STRATEGY INFO ===\n');
    console.log(`Name: ${strategy.name}`);
    console.log(`Mode: ${strategy.mode}`);
    console.log(`Status: ${strategy.status}`);
    console.log(`Chain ID: ${strategy.chainId}`);
    console.log(`Base Asset: ${strategy.baseAsset}`);
    console.log(`Universe: ${JSON.parse(strategy.universeJson || '[]').join(', ')}`);
    console.log(`Timeframe: ${strategy.timeframe}`);

    // Get recent paper trades
    const recentTrades = await prisma.trade.findMany({
      where: {
        strategyId,
        mode: 'PAPER',
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    console.log(`\n=== RECENT PAPER TRADES (Last 10) ===\n`);
    if (recentTrades.length === 0) {
      console.log('No paper trades found');
    } else {
      recentTrades.forEach((trade, i) => {
        console.log(`${i + 1}. ${trade.side} ${trade.size} ${trade.symbol} @ $${trade.entryPrice?.toFixed(2) || 'N/A'}`);
        console.log(`   P&L: $${trade.pnl?.toFixed(2) || 'N/A'} (${trade.pnlPct?.toFixed(2) || 'N/A'}%)`);
        console.log(`   Time: ${new Date(trade.timestamp).toISOString()}`);
        console.log(`   Confidence: ${trade.confidence?.toFixed(2) || 'N/A'}`);
        console.log('');
      });
    }

    // Get total paper trades
    const totalTrades = await prisma.trade.count({
      where: {
        strategyId,
        mode: 'PAPER',
      },
    });

    // Get closed trades stats
    const closedTrades = await prisma.trade.findMany({
      where: {
        strategyId,
        mode: 'PAPER',
        exitPrice: { not: null },
      },
    });

    const winRate = closedTrades.length > 0
      ? closedTrades.filter(t => (t.pnl || 0) > 0).length / closedTrades.length
      : 0;

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    console.log(`\n=== STATISTICS ===\n`);
    console.log(`Total Paper Trades: ${totalTrades}`);
    console.log(`Closed Trades: ${closedTrades.length}`);
    console.log(`Win Rate: ${(winRate * 100).toFixed(2)}%`);
    console.log(`Total P&L: $${totalPnl.toFixed(2)}`);

    // Get recent decisions
    const recentDecisions = await prisma.prediction.findMany({
      where: {
        strategyId,
      },
      orderBy: { timestamp: 'desc' },
      take: 5,
    });

    console.log(`\n=== RECENT DECISIONS (Last 5) ===\n`);
    if (recentDecisions.length === 0) {
      console.log('No decisions found');
    } else {
      recentDecisions.forEach((pred, i) => {
        const decision = pred.decision as any;
        console.log(`${i + 1}. ${decision.action} (${(decision.confidence * 100).toFixed(0)}% confidence)`);
        console.log(`   Time: ${new Date(pred.timestamp).toISOString()}`);
        console.log(`   Notes: ${decision.notes || 'N/A'}`);
        console.log('');
      });
    }

    // Check if paper trading is active
    const isActive = strategy.status === 'ACTIVE' && strategy.mode === 'PAPER';
    console.log(`\n=== STATUS ===\n`);
    console.log(`Paper Trading Active: ${isActive ? '✅ YES' : '❌ NO'}`);
    if (!isActive) {
      console.log(`\nTo start paper trading, ensure:`);
      console.log(`1. Strategy mode is 'PAPER'`);
      console.log(`2. Strategy status is 'ACTIVE'`);
      console.log(`3. API server is running`);
      console.log(`4. Data feed is working (check logs)`);
    }

    console.log('\n✅ Paper trading check completed');
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Paper trading check failed');
    console.error('\n❌ Paper trading check failed:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error in paper trading check');
  process.exit(1);
});

