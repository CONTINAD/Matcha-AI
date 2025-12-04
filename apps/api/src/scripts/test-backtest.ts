import 'dotenv/config';
import { backtester } from '../services/backtester';
import { dataFeed } from '../services/dataFeed';
import { logger } from '../config/logger';

/**
 * Test script for backtesting
 * 
 * Usage:
 *   pnpm tsx apps/api/src/scripts/test-backtest.ts <symbol> <timeframe> <chainId>
 * 
 * Example:
 *   pnpm tsx apps/api/src/scripts/test-backtest.ts WETH 5m 137
 */

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Usage: test-backtest.ts <symbol> <timeframe> <chainId>');
    console.error('Example: test-backtest.ts WETH 5m 137');
    process.exit(1);
  }

  const symbol = args[0];
  const timeframe = args[1];
  const chainId = parseInt(args[2], 10);
  const baseAsset = 'USDC';

  if (isNaN(chainId)) {
    console.error('Invalid chainId:', args[2]);
    process.exit(1);
  }

  // Calculate date range (last 7 days)
  const to = Date.now();
  const from = to - (7 * 24 * 60 * 60 * 1000);

  logger.info({ symbol, timeframe, chainId, from: new Date(from), to: new Date(to) }, 'Starting backtest');

  try {
    // Get historical candles
    const candles = await dataFeed.getHistoricalCandles({
      symbol,
      timeframe,
      from,
      to,
      chainId,
      baseAsset,
      useCache: true,
    });

    if (candles.length < 50) {
      throw new Error(`Not enough candles: ${candles.length} (need at least 50)`);
    }

    logger.info({ candles: candles.length, first: new Date(candles[0].timestamp), last: new Date(candles[candles.length - 1].timestamp) }, 'Fetched historical candles');

    // Run backtest with fast mode (no AI)
    const strategyConfig = {
      baseAsset,
      universe: [symbol],
      timeframe,
      riskLimits: {
        maxPositionPct: 5,
        maxDailyLossPct: 3,
        stopLossPct: 2,
        takeProfitPct: 4,
      },
      indicators: {
        rsi: { period: 14, overbought: 70, oversold: 30 },
        ema: { fast: 9, slow: 21 },
      },
      ai: {
        mode: 'OFF' as const, // Fast mode - no AI
      },
    };

    const result = await backtester.runBacktest({
      strategyConfig,
      candles,
      initialEquity: 10000,
      fastMode: true, // Use fast mode
    });

    console.log('\n=== BACKTEST RESULTS ===\n');
    console.log(`Total Return: $${result.totalReturn.toFixed(2)} (${result.totalReturnPct.toFixed(2)}%)`);
    console.log(`Max Drawdown: ${result.performance.maxDrawdown.toFixed(2)}%`);
    console.log(`Win Rate: ${(result.performance.winRate * 100).toFixed(2)}%`);
    console.log(`Sharpe Ratio: ${result.performance.sharpe?.toFixed(2) || 'N/A'}`);
    console.log(`Total Trades: ${result.trades.length}`);
    console.log(`Winning Trades: ${result.performance.winningTrades || 0}`);
    console.log(`Losing Trades: ${result.performance.losingTrades || 0}`);
    console.log(`\nFirst Trade: ${result.trades[0] ? new Date(result.trades[0].timestamp).toISOString() : 'N/A'}`);
    console.log(`Last Trade: ${result.trades[result.trades.length - 1] ? new Date(result.trades[result.trades.length - 1].timestamp).toISOString() : 'N/A'}`);
    
    if (result.trades.length > 0) {
      const avgPnl = result.trades.reduce((sum, t) => sum + (t.pnl || 0), 0) / result.trades.length;
      const bestTrade = result.trades.reduce((best, t) => (t.pnl || 0) > (best.pnl || 0) ? t : best, result.trades[0]);
      const worstTrade = result.trades.reduce((worst, t) => (t.pnl || 0) < (worst.pnl || 0) ? t : worst, result.trades[0]);
      
      console.log(`\nAverage P&L per Trade: $${avgPnl.toFixed(2)}`);
      console.log(`Best Trade: $${bestTrade.pnl?.toFixed(2) || 'N/A'} (${bestTrade.side} ${bestTrade.size} @ ${bestTrade.entryPrice})`);
      console.log(`Worst Trade: $${worstTrade.pnl?.toFixed(2) || 'N/A'} (${worstTrade.side} ${worstTrade.size} @ ${worstTrade.entryPrice})`);
    }

    console.log('\n✅ Backtest completed successfully');
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Backtest failed');
    console.error('\n❌ Backtest failed:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error in backtest');
  process.exit(1);
});

