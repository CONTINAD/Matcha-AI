import type { StrategyConfig } from '@matcha-ai/shared';
import { parameterSweeper } from './parameterSweeper';
import { logger } from '../config/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Strategy Auto-Tuner
 * 
 * Uses parameter sweeper to find optimal parameters:
 * - Run sweep weekly on recent performance data
 * - Auto-update strategy config if new params are 20% better
 * - A/B test: Run old and new params in parallel, keep winner
 */
export class StrategyTuner {
  /**
   * Tune strategy parameters based on recent performance
   */
  async tuneStrategy(strategyId: string): Promise<{
    improved: boolean;
    newConfig?: StrategyConfig;
    improvement?: number;
  }> {
    try {
      // Get current strategy config
      const strategy = await prisma.strategy.findUnique({
        where: { id: strategyId },
        select: { configJson: true },
      });

      if (!strategy?.configJson) {
        return { improved: false };
      }

      const currentConfig = JSON.parse(strategy.configJson) as StrategyConfig;

      // Define parameter ranges to sweep
      const parameterRanges = {
        rsi: {
          period: [10, 12, 14, 16, 18],
          overbought: [65, 70, 75, 80],
          oversold: [20, 25, 30, 35],
        },
        ema: {
          fast: [7, 9, 12, 15],
          slow: [18, 21, 26, 30],
        },
        riskLimits: {
          maxPositionPct: [3, 5, 7, 10],
          stopLossPct: [1.5, 2, 2.5, 3],
          takeProfitPct: [3, 4, 5, 6],
        },
        thresholds: {
          minConfidence: [0.5, 0.6, 0.7, 0.75],
        },
      };

      // Run parameter sweep
      logger.info({ strategyId }, 'Starting parameter sweep for strategy tuning');
      const sweepResults = await parameterSweeper.runParameterSweep(
        strategyId,
        parameterRanges,
        {
          maxIterations: 50, // Limit iterations for weekly runs
          minTrades: 10, // Need at least 10 trades per config
        }
      );

      if (!sweepResults || sweepResults.length === 0) {
        return { improved: false };
      }

      // Find best configuration
      const bestConfig = sweepResults.reduce((best, current) => {
        const bestScore = this.calculateConfigScore(best);
        const currentScore = this.calculateConfigScore(current);
        return currentScore > bestScore ? current : best;
      });

      // Compare with current config
      const currentScore = this.calculateConfigScore({ config: currentConfig, metrics: null });
      const bestScore = this.calculateConfigScore(bestConfig);

      const improvement = bestScore > 0 && currentScore > 0
        ? ((bestScore - currentScore) / currentScore) * 100
        : 0;

      // Only update if improvement is significant (20%+)
      if (improvement >= 20) {
        logger.info(
          {
            strategyId,
            improvement,
            currentScore,
            bestScore,
          },
          'Found significantly better configuration, updating strategy'
        );

        return {
          improved: true,
          newConfig: bestConfig.config,
          improvement,
        };
      }

      return { improved: false };
    } catch (error) {
      logger.error({ error, strategyId }, 'Error tuning strategy');
      return { improved: false };
    }
  }

  /**
   * Calculate score for a configuration based on metrics
   */
  private calculateConfigScore(result: {
    config: StrategyConfig;
    metrics: { sharpeRatio?: number; winRate?: number; totalTrades?: number } | null;
  }): number {
    if (!result.metrics) {
      return 0;
    }

    const { sharpeRatio = 0, winRate = 0, totalTrades = 0 } = result.metrics;

    // Score = Sharpe * 0.5 + WinRate * 0.3 + (trades > 10 ? 0.2 : 0)
    // Prioritize Sharpe ratio, then win rate, then trade count
    const score = sharpeRatio * 0.5 + winRate * 0.3 + (totalTrades >= 10 ? 0.2 : 0);

    return score;
  }

  /**
   * A/B test two configurations
   */
  async abTestConfigurations(
    strategyId: string,
    configA: StrategyConfig,
    configB: StrategyConfig,
    durationDays: number = 7
  ): Promise<{ winner: 'A' | 'B' | 'tie'; metricsA: any; metricsB: any }> {
    // This would require running two parallel strategies
    // For now, we'll use a simplified approach: run backtests for both
    logger.info(
      {
        strategyId,
        durationDays,
      },
      'Starting A/B test for strategy configurations'
    );

    // TODO: Implement A/B testing by running parallel backtests or paper trading
    // For now, return tie
    return {
      winner: 'tie',
      metricsA: null,
      metricsB: null,
    };
  }
}

export const strategyTuner = new StrategyTuner();

