import { PrismaClient } from '@prisma/client';
import type { StrategyConfig, PerformanceMetrics } from '@matcha-ai/shared';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface AdaptiveConfig {
  confidenceThreshold: number; // Minimum confidence to take a trade
  positionSizeMultiplier: number; // Multiplier for position sizing
  maxTradesPerDay: number; // Limit on number of trades
  marketRegimeAdjustments: Record<string, number>; // Adjustments per regime
}

export class AdaptiveLearning {
  /**
   * Adapt strategy configuration based on performance
   */
  async adaptConfig(
    strategyId: string,
    currentConfig: StrategyConfig,
    performance: PerformanceMetrics
  ): Promise<Partial<StrategyConfig>> {
    const adaptations: Partial<StrategyConfig> = {};

    // If win rate is low, become more conservative
    if (performance.winRate < 0.4 && performance.totalTrades && performance.totalTrades > 20) {
      adaptations.thresholds = {
        ...currentConfig.thresholds,
        minConfidence: Math.max(0.7, (currentConfig.thresholds?.minConfidence || 0.6) + 0.1),
      };
      logger.info({ strategyId }, 'Adapting: Increasing confidence threshold due to low win rate');
    }

    // If Sharpe is negative, reduce position sizes
    if (performance.sharpe !== undefined && performance.sharpe < 0) {
      const currentMaxPosition = currentConfig.riskLimits.maxPositionPct;
      adaptations.riskLimits = {
        ...currentConfig.riskLimits,
        maxPositionPct: Math.max(5, currentMaxPosition * 0.8), // Reduce by 20%
      };
      logger.info({ strategyId }, 'Adapting: Reducing position size due to negative Sharpe');
    }

    // If drawdown is high, tighten risk limits
    if (performance.maxDrawdown > 15) {
      adaptations.riskLimits = {
        ...currentConfig.riskLimits,
        maxDailyLossPct: Math.max(2, currentConfig.riskLimits.maxDailyLossPct * 0.8),
      };
      logger.info({ strategyId }, 'Adapting: Tightening daily loss limit due to high drawdown');
    }

    // If performing well, can be slightly more aggressive (but still within limits)
    if (performance.winRate > 0.6 && performance.sharpe && performance.sharpe > 1.5) {
      adaptations.thresholds = {
        ...currentConfig.thresholds,
        minConfidence: Math.max(0.5, (currentConfig.thresholds?.minConfidence || 0.6) - 0.05),
      };
      logger.info({ strategyId }, 'Adapting: Slightly lowering confidence threshold due to strong performance');
    }

    return adaptations;
  }

  /**
   * Get adaptive confidence threshold based on recent performance
   */
  getAdaptiveConfidenceThreshold(performance: PerformanceMetrics, baseThreshold = 0.6): number {
    let threshold = baseThreshold;

    // Increase threshold if win rate is low
    if (performance.winRate < 0.4) {
      threshold += 0.1;
    }

    // Increase threshold if in drawdown
    if (performance.maxDrawdown > 10) {
      threshold += 0.05;
    }

    // Decrease threshold slightly if performing well
    if (performance.winRate > 0.6 && performance.sharpe && performance.sharpe > 1) {
      threshold -= 0.05;
    }

    return Math.max(0.5, Math.min(0.9, threshold));
  }

  /**
   * Get adaptive position size multiplier
   */
  getAdaptivePositionMultiplier(performance: PerformanceMetrics): number {
    let multiplier = 1.0;

    // Reduce size if win rate is low
    if (performance.winRate < 0.4) {
      multiplier *= 0.7;
    }

    // Reduce size if in drawdown
    if (performance.maxDrawdown > 10) {
      multiplier *= 0.8;
    }

    // Increase size slightly if performing well
    if (performance.winRate > 0.6 && performance.sharpe && performance.sharpe > 1.5) {
      multiplier *= 1.1;
    }

    return Math.max(0.5, Math.min(1.2, multiplier));
  }
}

export const adaptiveLearning = new AdaptiveLearning();

