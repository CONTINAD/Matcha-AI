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
   * Check if a strategy is profitable enough for live trading
   * Requirements:
   * - Sharpe > 2.0
   * - Avg return > 15% MoM
   * - Win rate > 50%
   * - Max drawdown < 20%
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

    // Run multiple backtests
    for (let i = 0; i < numSims; i++) {
      try {
        // Get historical data
        const to = Date.now();
        const from = to - 30 * 24 * 60 * 60 * 1000; // 30 days

        const candles = await dataFeed.getHistoricalCandles({
          symbol: strategy.baseAsset || 'USDC',
          timeframe: strategy.timeframe,
          from,
          to,
          chainId: strategy.chainId || 1,
          baseAsset: strategy.baseAsset || 'USDC',
        });

        if (candles.length < 50) {
          logger.warn({ strategyId, i }, 'Not enough candles for backtest');
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

        results.push({
          sharpe: result.performance.sharpe || 0,
          totalReturn: result.totalReturnPct,
          winRate: result.performance.winRate || 0,
          maxDrawdown: result.performance.maxDrawdown || 0,
        });
      } catch (error) {
        logger.error({ error, strategyId, i }, 'Error in profitability check run');
      }
    }

    if (results.length < 10) {
      return {
        passed: false,
        message: `Not enough successful backtests (${results.length}/100). Strategy may need more data or configuration.`,
      };
    }

    // Calculate averages
    const avgSharpe = results.reduce((sum, r) => sum + r.sharpe, 0) / results.length;
    const avgReturn = results.reduce((sum, r) => sum + r.totalReturn, 0) / results.length;
    const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;
    const avgMaxDrawdown = results.reduce((sum, r) => sum + r.maxDrawdown, 0) / results.length;

    // Count passed runs
    const passedRuns = results.filter(
      (r) => r.sharpe > 2.0 && r.totalReturn > 15 && r.winRate > 0.5 && r.maxDrawdown < 20
    ).length;

    const passed = avgSharpe > 2.0 && avgReturn > 15 && avgWinRate > 0.5 && avgMaxDrawdown < 20;

    const message = passed
      ? `Strategy passed profitability check: Sharpe ${avgSharpe.toFixed(2)} > 2.0, Return ${avgReturn.toFixed(1)}% > 15%, Win Rate ${(avgWinRate * 100).toFixed(1)}% > 50%, Drawdown ${avgMaxDrawdown.toFixed(1)}% < 20%`
      : `Strategy failed profitability check: Sharpe ${avgSharpe.toFixed(2)} (need >2.0), Return ${avgReturn.toFixed(1)}% (need >15%), Win Rate ${(avgWinRate * 100).toFixed(1)}% (need >50%), Drawdown ${avgMaxDrawdown.toFixed(1)}% (need <20%)`;

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
   * Quick check using recent paper trading performance
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

    if (!strategy || !strategy.trades || strategy.trades.length < 10) {
      return {
        passed: false,
        message: 'Not enough recent trades (need at least 10)',
      };
    }

    const trades = strategy.trades;
    const winningTrades = trades.filter((t) => (t.pnl || 0) > 0).length;
    const winRate = winningTrades / trades.length;

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgReturn = (totalPnl / 10000) * 100; // Assuming $10k starting

    // Calculate Sharpe (simplified)
    const returns = trades.map((t) => (t.pnl || 0) / 10000);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(365) : 0;

    const passed = sharpe > 2.0 && avgReturn > 15 && winRate > 0.5;

    return {
      passed,
      sharpe,
      avgReturn,
      winRate,
      message: passed
        ? `Recent performance passed: Sharpe ${sharpe.toFixed(2)}, Return ${avgReturn.toFixed(1)}%, Win Rate ${(winRate * 100).toFixed(1)}%`
        : `Recent performance insufficient: Sharpe ${sharpe.toFixed(2)} (need >2.0), Return ${avgReturn.toFixed(1)}% (need >15%), Win Rate ${(winRate * 100).toFixed(1)}% (need >50%)`,
    };
  }
}

export const profitGate = new ProfitGate();

