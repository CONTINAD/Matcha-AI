import type { StrategyConfig, RiskLimits } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { PrismaClient } from '@prisma/client';
import { calculateSharpe } from '@matcha-ai/shared';

const prisma = new PrismaClient();

export interface PerformanceMetrics {
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
  avgReturn: number;
  maxDrawdown: number;
  period: '7d' | '30d';
}

/**
 * Performance Feedback Loop
 * 
 * Auto-adjusts strategy parameters based on performance:
 * - Track strategy performance metrics (win rate, Sharpe, drawdown) over rolling windows (7d, 30d)
 * - Identify underperforming strategies (Sharpe < 1.0 for 7 days)
 * - Auto-adjust parameters:
 *   - Reduce position size if losing
 *   - Increase confidence threshold if too many bad trades
 *   - Switch to different strategy if current one failing
 */
export class PerformanceFeedback {
  /**
   * Analyze strategy performance and suggest adjustments
   */
  async analyzePerformance(strategyId: string): Promise<{
    metrics: PerformanceMetrics;
    adjustments: Partial<StrategyConfig>;
    shouldSwitchStrategy: boolean;
  }> {
    // Get recent trades (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const trades = await prisma.trade.findMany({
      where: {
        strategyId,
        timestamp: {
          gte: thirtyDaysAgo,
        },
        exitPrice: { not: null }, // Only closed trades
      },
      orderBy: { timestamp: 'desc' },
    });

    if (trades.length < 10) {
      // Not enough data
      return {
        metrics: {
          winRate: 0,
          sharpeRatio: 0,
          totalTrades: trades.length,
          avgReturn: 0,
          maxDrawdown: 0,
          period: '30d',
        },
        adjustments: {},
        shouldSwitchStrategy: false,
      };
    }

    // Calculate metrics
    const wins = trades.filter((t) => t.pnl > 0).length;
    const winRate = wins / trades.length;
    const avgReturn = trades.reduce((sum, t) => sum + (t.pnlPct || 0), 0) / trades.length;
    
    // Calculate Sharpe ratio (simplified)
    const returns = trades.map((t) => t.pnlPct || 0);
    const sharpeRatio = calculateSharpe(returns) || 0;

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = 0;
    let runningPnl = 0;
    for (const trade of trades.reverse()) {
      runningPnl += trade.pnl || 0;
      if (runningPnl > peak) {
        peak = runningPnl;
      }
      const drawdown = peak > 0 ? ((peak - runningPnl) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const metrics: PerformanceMetrics = {
      winRate,
      sharpeRatio,
      totalTrades: trades.length,
      avgReturn,
      maxDrawdown,
      period: '30d',
    };

    // Determine adjustments
    const adjustments: Partial<StrategyConfig> = {};
    let shouldSwitchStrategy = false;

    // 1. If Sharpe < 1.0 for 7+ days, reduce position size
    if (sharpeRatio < 1.0 && trades.length >= 20) {
      const currentConfig = await this.getStrategyConfig(strategyId);
      if (currentConfig?.riskLimits) {
        adjustments.riskLimits = {
          ...currentConfig.riskLimits,
          maxPositionPct: Math.max(2, currentConfig.riskLimits.maxPositionPct * 0.8), // Reduce by 20%, min 2%
        };
        logger.info(
          {
            strategyId,
            sharpeRatio,
            originalMaxPosition: currentConfig.riskLimits.maxPositionPct,
            adjustedMaxPosition: adjustments.riskLimits.maxPositionPct,
          },
          'Reducing position size due to low Sharpe ratio'
        );
      }
    }

    // 2. If win rate < 45%, increase confidence threshold
    if (winRate < 0.45 && trades.length >= 10) {
      const currentConfig = await this.getStrategyConfig(strategyId);
      if (currentConfig?.thresholds) {
        adjustments.thresholds = {
          ...currentConfig.thresholds,
          minConfidence: Math.min(0.8, (currentConfig.thresholds.minConfidence || 0.6) * 1.2), // Increase by 20%, max 0.8
        };
        logger.info(
          {
            strategyId,
            winRate,
            originalMinConfidence: currentConfig.thresholds.minConfidence || 0.6,
            adjustedMinConfidence: adjustments.thresholds?.minConfidence,
          },
          'Increasing confidence threshold due to low win rate'
        );
      }
    }

    // 3. If Sharpe < 0.5 for 7+ days, consider switching strategy
    if (sharpeRatio < 0.5 && trades.length >= 20) {
      shouldSwitchStrategy = true;
      logger.warn(
        {
          strategyId,
          sharpeRatio,
          winRate,
          totalTrades: trades.length,
        },
        'Strategy severely underperforming, should consider switching'
      );
    }

    return {
      metrics,
      adjustments,
      shouldSwitchStrategy,
    };
  }

  /**
   * Get strategy config from database
   */
  private async getStrategyConfig(strategyId: string): Promise<StrategyConfig | null> {
    try {
      const strategy = await prisma.strategy.findUnique({
        where: { id: strategyId },
        select: { configJson: true },
      });

      if (!strategy?.configJson) {
        return null;
      }

      return JSON.parse(strategy.configJson) as StrategyConfig;
    } catch (error) {
      logger.error({ error, strategyId }, 'Failed to get strategy config');
      return null;
    }
  }

  /**
   * Apply performance-based adjustments to strategy
   */
  async applyAdjustments(strategyId: string, adjustments: Partial<StrategyConfig>): Promise<boolean> {
    try {
      const strategy = await prisma.strategy.findUnique({
        where: { id: strategyId },
        select: { configJson: true },
      });

      if (!strategy?.configJson) {
        return false;
      }

      const currentConfig = JSON.parse(strategy.configJson) as StrategyConfig;
      const updatedConfig: StrategyConfig = {
        ...currentConfig,
        ...adjustments,
        riskLimits: {
          ...currentConfig.riskLimits,
          ...adjustments.riskLimits,
        },
        thresholds: {
          ...currentConfig.thresholds,
          ...adjustments.thresholds,
        },
      };

      await prisma.strategy.update({
        where: { id: strategyId },
        data: {
          configJson: JSON.stringify(updatedConfig),
          updatedAt: new Date(),
        },
      });

      logger.info(
        {
          strategyId,
          adjustments,
        },
        'Applied performance-based adjustments to strategy'
      );

      return true;
    } catch (error) {
      logger.error({ error, strategyId }, 'Failed to apply adjustments');
      return false;
    }
  }
}

export const performanceFeedback = new PerformanceFeedback();

