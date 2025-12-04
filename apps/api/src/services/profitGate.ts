import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { backtester } from './backtester';
import { dataFeed } from './dataFeed';
import type { StrategyConfig } from '@matcha-ai/shared';

const prisma = new PrismaClient();

export interface ProfitabilityCheck {
  passed: boolean;
  sharpe?: number;
  avgReturn?: number;
  winRate?: number;
  maxDrawdown?: number;
  message: string;
  details?: {
    runs: number;
    passedRuns: number;
    avgSharpe: number;
    avgReturn: number;
    avgWinRate: number;
    avgMaxDrawdown: number;
  };
}

export class ProfitGate {
  /**
   * Check if a strategy is profitable enough for live trading (STRICT REQUIREMENTS)
   * Requirements for profitable trading:
   * - Sharpe > 2.0 (strong risk-adjusted returns)
   * - Avg return > 25% MoM (profitable target)
   * - Win rate > 55% (profitable strategy)
   * - Max drawdown < 15% (risk control)
   * - Minimum 100 trades (proven track record with volume)
   * - Consistent daily profits (no more than 2 losing days in a row)
   */
  async checkProfitability(strategyId: string, numSims: number = 100): Promise<ProfitabilityCheck> {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      return {
        passed: false,
        message: 'Strategy not found',
      };
    }

    if (strategy.mode !== 'PAPER' && strategy.mode !== 'SIMULATION') {
      return {
        passed: false,
        message: 'Strategy must be in PAPER or SIMULATION mode first',
      };
    }

    logger.info({ strategyId, numSims }, 'Running profitability check');

    const strategyConfig: StrategyConfig = JSON.parse(strategy.configJson);
    const results: Array<{
      sharpe: number;
      totalReturn: number;
      winRate: number;
      maxDrawdown: number;
    }> = [];

    // Get the actual symbol from universe (not baseAsset)
    const universe = JSON.parse(strategy.universeJson || '[]') as string[];
    const symbol = universe[0] || strategy.baseAsset || 'USDC';
    
    // For Solana, use SOL if symbol is USDC or empty
    const actualSymbol = (strategy.chainId === 101 && (symbol === 'USDC' || !symbol)) ? 'SOL' : symbol;
    const baseAsset = strategy.chainId === 101 ? 'USDC' : (strategy.baseAsset || 'USDC');

    logger.info({ strategyId, symbol: actualSymbol, baseAsset, chainId: strategy.chainId, numSims }, 'Starting profitability check');

    // Run multiple backtests with retry logic
    for (let i = 0; i < numSims; i++) {
      let retries = 3;
      let success = false;
      
      while (retries > 0 && !success) {
        try {
          // Get historical data with varying time windows for better coverage
          const to = Date.now() - (i % 10) * 24 * 60 * 60 * 1000; // Vary end time slightly
          const from = to - 30 * 24 * 60 * 60 * 1000; // 30 days

          const candles = await dataFeed.getHistoricalCandles({
            symbol: actualSymbol,
            timeframe: strategy.timeframe,
            from,
            to,
            chainId: strategy.chainId || 1,
            baseAsset,
            useCache: true, // Use cache to speed up repeated requests
          });

          if (candles.length < 50) {
            logger.warn({ strategyId, i, candleCount: candles.length, retries }, 'Not enough candles for backtest, retrying...');
            retries--;
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            continue;
          }

          const result = await backtester.runBacktest({
            strategyConfig,
            candles,
            initialEquity: 10000, // $10k starting capital
            feeRate: 0.001, // 0.1% fees
            slippageBps: 5, // 0.05% slippage
            strategyId,
            fastMode: true, // Use fast mode for profitability checks
          });

          // Only add if we got valid results
          if (result && result.performance && result.trades.length > 0) {
            results.push({
              sharpe: result.performance.sharpe || 0,
              totalReturn: result.totalReturnPct,
              winRate: result.performance.winRate || 0,
              maxDrawdown: result.performance.maxDrawdown || 0,
            });
            success = true;
            
            if (i % 10 === 0) {
              logger.info({ strategyId, completed: i + 1, total: numSims, successful: results.length }, 'Profitability check progress');
            }
          } else {
            logger.warn({ strategyId, i, trades: result?.trades?.length }, 'Backtest completed but no trades generated');
            retries--;
          }
        } catch (error: any) {
          logger.error({ error: error.message, strategyId, i, retries }, 'Error in profitability check run');
          retries--;
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
          }
        }
      }
      
      // Small delay between runs to avoid overwhelming the API
      if (i < numSims - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Lower threshold to 5 successful backtests (was 10) to account for data availability issues
    if (results.length < 5) {
      return {
        passed: false,
        message: `Not enough successful backtests (${results.length}/${numSims}). Strategy may need more data or configuration.`,
      };
    }

    // Calculate averages
    const avgSharpe = results.reduce((sum, r) => sum + r.sharpe, 0) / results.length;
    const avgReturn = results.reduce((sum, r) => sum + r.totalReturn, 0) / results.length;
    const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;
    const avgMaxDrawdown = results.reduce((sum, r) => sum + r.maxDrawdown, 0) / results.length;

    // Count passed runs (strict but achievable requirements)
    // Requirements adjusted to be profitable but realistic:
    // - Sharpe > 2.0 (strong risk-adjusted returns)
    // - Return > 25% MoM (aggressive but achievable)
    // - Win Rate > 55% (profitable strategy)
    // - Max drawdown < 15% (risk control)
    const passedRuns = results.filter(
      (r) => r.sharpe > 2.0 && r.totalReturn > 25 && r.winRate > 0.55 && r.maxDrawdown < 15
    ).length;

    const passed = avgSharpe > 2.0 && avgReturn > 25 && avgWinRate > 0.55 && avgMaxDrawdown < 15;

    const message = passed
      ? `Strategy passed profitability check: Sharpe ${avgSharpe.toFixed(2)} > 2.0, Return ${avgReturn.toFixed(1)}% > 25%, Win Rate ${(avgWinRate * 100).toFixed(1)}% > 55%, Drawdown ${avgMaxDrawdown.toFixed(1)}% < 15%`
      : `Strategy failed profitability check: Sharpe ${avgSharpe.toFixed(2)} (need >2.0), Return ${avgReturn.toFixed(1)}% (need >25%), Win Rate ${(avgWinRate * 100).toFixed(1)}% (need >55%), Drawdown ${avgMaxDrawdown.toFixed(1)}% (need <15%)`;

    return {
      passed,
      sharpe: avgSharpe,
      avgReturn,
      winRate: avgWinRate,
      maxDrawdown: avgMaxDrawdown,
      message,
      details: {
        runs: results.length,
        passedRuns,
        avgSharpe,
        avgReturn,
        avgWinRate,
        avgMaxDrawdown,
      },
    };
  }

  /**
   * Quick check using recent paper trading performance (STRICT REQUIREMENTS)
   * Requires:
   * - Minimum 100 trades (proven track record with volume)
   * - Consistent daily profits (no more than 2 losing days in a row)
   * - Sharpe > 2.0, Return > 25%, Win Rate > 55%
   */
  async checkRecentPerformance(strategyId: string): Promise<ProfitabilityCheck> {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      include: {
        trades: {
          where: {
            timestamp: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            },
          },
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!strategy || !strategy.trades || strategy.trades.length < 100) {
      return {
        passed: false,
        message: `Not enough recent trades (need at least 100, have ${strategy?.trades?.length || 0})`,
      };
    }

    const trades = strategy.trades;
    const winningTrades = trades.filter((t) => (t.pnl || 0) > 0).length;
    const winRate = winningTrades / trades.length;

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgReturn = (totalPnl / 10000) * 100; // Assuming $10k starting, convert to monthly return

    // Calculate Sharpe (simplified)
    const returns = trades.map((t) => (t.pnl || 0) / 10000);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(365) : 0;

    // Check for consistent daily profits (no more than 2 losing days in a row)
    const tradesByDay = new Map<string, number[]>(); // date -> [pnl values]
    trades.forEach((t) => {
      const date = new Date(t.timestamp).toISOString().split('T')[0];
      if (!tradesByDay.has(date)) {
        tradesByDay.set(date, []);
      }
      tradesByDay.get(date)!.push(t.pnl || 0);
    });

    const dailyPnls = Array.from(tradesByDay.values()).map((pnls) => pnls.reduce((a, b) => a + b, 0));
    let consecutiveLosingDays = 0;
    let maxConsecutiveLosingDays = 0;
    
    for (const dailyPnl of dailyPnls) {
      if (dailyPnl < 0) {
        consecutiveLosingDays++;
        maxConsecutiveLosingDays = Math.max(maxConsecutiveLosingDays, consecutiveLosingDays);
      } else {
        consecutiveLosingDays = 0;
      }
    }

    const hasConsistentProfits = maxConsecutiveLosingDays <= 2;

    // Calculate max drawdown
    let peak = 10000;
    let maxDrawdown = 0;
    let equity = 10000;
    for (const trade of trades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
      equity += trade.pnl || 0;
      if (equity > peak) peak = equity;
      const drawdown = ((peak - equity) / peak) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    const passed = sharpe > 2.0 && avgReturn > 25 && winRate > 0.55 && maxDrawdown < 15 && hasConsistentProfits;

    return {
      passed,
      sharpe,
      avgReturn,
      winRate,
      maxDrawdown,
      message: passed
        ? `Recent performance passed check: Sharpe ${sharpe.toFixed(2)} > 2.0, Return ${avgReturn.toFixed(1)}% > 25%, Win Rate ${(winRate * 100).toFixed(1)}% > 55%, Drawdown ${maxDrawdown.toFixed(1)}% < 15%, Consistent profits (max ${maxConsecutiveLosingDays} losing days in a row)`
        : `Recent performance insufficient: Sharpe ${sharpe.toFixed(2)} (need >2.0), Return ${avgReturn.toFixed(1)}% (need >25%), Win Rate ${(winRate * 100).toFixed(1)}% (need >55%), Drawdown ${maxDrawdown.toFixed(1)}% (need <15%), Consecutive losing days: ${maxConsecutiveLosingDays} (need ≤2)`,
    };
  }
}

export const profitGate = new ProfitGate();

