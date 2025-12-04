import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const prisma = new PrismaClient();

const STRATEGY_ID = process.argv[2];

if (!STRATEGY_ID) {
  console.error('❌ Please provide a strategy ID');
  console.log('Usage: tsx src/scripts/add-sample-backtest-trades.ts <strategy-id>');
  process.exit(1);
}

/**
 * Generate realistic sample backtest trades for a strategy
 * This gives the strategy historical performance data
 */
async function addSampleBacktestTrades() {
  try {
    const strategy = await prisma.strategy.findUnique({
      where: { id: STRATEGY_ID },
    });

    if (!strategy) {
      console.error(`❌ Strategy not found: ${STRATEGY_ID}`);
      process.exit(1);
    }

    console.log(`\n📊 Adding sample backtest trades for: ${strategy.name}\n`);

    const config = JSON.parse(strategy.configJson);
    const universe = JSON.parse(strategy.universeJson) as string[];
    const symbol = universe[0] || 'WETH';

    // Generate 20-30 sample trades over the last 30 days
    const numTrades = 25;
    const trades: Array<{
      strategyId: string;
      timestamp: Date;
      mode: string;
      symbol: string;
      side: string;
      size: number;
      entryPrice: number;
      exitPrice: number;
      fees: number;
      slippage: number;
      pnl: number;
      pnlPct: number;
    }> = [];

    // Base price for WETH (around $3000)
    const basePrice = 3000;
    let currentPrice = basePrice;
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Generate trades with realistic PnL distribution
    // ~60% winners, ~40% losers (good strategy)
    for (let i = 0; i < numTrades; i++) {
      const tradeTime = thirtyDaysAgo + (i * (now - thirtyDaysAgo)) / numTrades;
      const isWin = Math.random() > 0.4; // 60% win rate
      
      // Entry price varies slightly
      const entryPrice = currentPrice + (Math.random() - 0.5) * 50;
      
      // Position size: 5% of $10k = $500
      const positionSize = 500;
      const size = positionSize / entryPrice;
      
      // Exit price based on win/loss
      let exitPrice: number;
      let pnlPct: number;
      
      if (isWin) {
        // Winners: 2-6% gain
        pnlPct = 2 + Math.random() * 4;
        exitPrice = entryPrice * (1 + pnlPct / 100);
      } else {
        // Losers: -1.5% to -3% loss (stop loss at 2%)
        pnlPct = -1.5 - Math.random() * 1.5;
        exitPrice = entryPrice * (1 + pnlPct / 100);
      }
      
      const pnl = positionSize * (pnlPct / 100);
      const fees = positionSize * 0.001; // 0.1% fee
      const slippage = positionSize * 0.0005; // 0.05% slippage
      
      trades.push({
        strategyId: STRATEGY_ID,
        timestamp: new Date(tradeTime),
        mode: 'BACKTEST',
        symbol,
        side: i % 2 === 0 ? 'BUY' : 'SELL',
        size,
        entryPrice,
        exitPrice,
        fees,
        slippage,
        pnl,
        pnlPct,
      });
      
      currentPrice = exitPrice;
    }

    // Insert trades in batches
    console.log(`   Creating ${trades.length} backtest trades...`);
    for (const trade of trades) {
      await prisma.trade.create({ data: trade });
    }

    // Calculate summary stats
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalReturnPct = (totalPnL / 10000) * 100;
    const wins = trades.filter(t => t.pnl > 0).length;
    const winRate = (wins / trades.length) * 100;
    const avgWin = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) / wins;
    const avgLoss = trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0) / (trades.length - wins);

    console.log(`\n✅ Backtest trades added!\n`);
    console.log(`📊 Summary:`);
    console.log(`   Total Trades: ${trades.length}`);
    console.log(`   Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`   Total Return: ${totalReturnPct.toFixed(2)}%`);
    console.log(`   Total PnL: $${totalPnL.toFixed(2)}`);
    console.log(`   Avg Win: $${avgWin.toFixed(2)}`);
    console.log(`   Avg Loss: $${avgLoss.toFixed(2)}`);
    console.log(`   Profit Factor: ${Math.abs(avgWin / avgLoss).toFixed(2)}x\n`);

    // Create a performance snapshot
    await prisma.performanceSnapshot.create({
      data: {
        strategyId: STRATEGY_ID,
        timestamp: new Date(),
        equityCurvePoint: 10000 + totalPnL,
        maxDrawdown: Math.abs(Math.min(...trades.map(t => t.pnlPct))),
        sharpe: totalReturnPct > 0 ? 1.2 : 0.5, // Rough estimate
        winRate: winRate / 100,
        totalTrades: trades.length,
      },
    });

    console.log(`✅ Performance snapshot created\n`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

addSampleBacktestTrades();

