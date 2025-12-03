import { PrismaClient } from '@prisma/client';
import type { Decision, MarketContext, Indicators } from '@matcha-ai/shared';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface TradeOutcome {
  strategyId: string;
  decision: Decision;
  context: {
    indicators: Indicators;
    marketRegime: string;
    performance: {
      winRate: number;
      sharpe?: number;
    };
  };
  outcome: 'win' | 'loss' | 'neutral';
  pnl: number;
  timestamp: number;
}

export interface LearnedPattern {
  conditions: {
    indicators: Partial<Indicators>;
    marketRegime: string;
    performanceContext: {
      winRateRange: [number, number];
      sharpeRange?: [number, number];
    };
  };
  outcome: 'win' | 'loss';
  confidence: number; // How often this pattern leads to this outcome
  sampleSize: number;
}

export class ReinforcementLearning {
  /**
   * Record a trade outcome for learning
   */
  async recordOutcome(outcome: TradeOutcome): Promise<void> {
    try {
      // Store in a learning table (simplified - using a JSON field in a new table)
      // For now, we'll use the existing Trade table and extract patterns from it
      logger.info({ strategyId: outcome.strategyId, outcome: outcome.outcome }, 'Trade outcome recorded for learning');
    } catch (error) {
      logger.error({ error }, 'Error recording trade outcome');
    }
  }

  /**
   * Analyze historical trades to learn patterns
   */
  async analyzePatterns(strategyId: string, minSamples = 10): Promise<LearnedPattern[]> {
    try {
      const trades = await prisma.trade.findMany({
        where: {
          strategyId,
          exitPrice: { not: null }, // Only closed trades
        },
        orderBy: { timestamp: 'desc' },
        take: 100, // Analyze last 100 trades
      });

      if (trades.length < minSamples) {
        return [];
      }

      const patterns: LearnedPattern[] = [];

      // Group trades by outcome
      const winningTrades = trades.filter((t) => t.pnl > 0);
      const losingTrades = trades.filter((t) => t.pnl < 0);

      // Learn from winning patterns
      if (winningTrades.length >= minSamples) {
        const avgWinPnL = winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length;
        const pattern: LearnedPattern = {
          conditions: {
            // We'd need to store indicator values with trades for full pattern matching
            // For now, this is a simplified version
            indicators: {},
            marketRegime: 'any',
            performanceContext: {
              winRateRange: [0.5, 1.0],
            },
          },
          outcome: 'win',
          confidence: winningTrades.length / trades.length,
          sampleSize: winningTrades.length,
        };
        patterns.push(pattern);
      }

      // Learn from losing patterns
      if (losingTrades.length >= minSamples) {
        const pattern: LearnedPattern = {
          conditions: {
            indicators: {},
            marketRegime: 'any',
            performanceContext: {
              winRateRange: [0, 0.5],
            },
          },
          outcome: 'loss',
          confidence: losingTrades.length / trades.length,
          sampleSize: losingTrades.length,
        };
        patterns.push(pattern);
      }

      return patterns;
    } catch (error) {
      logger.error({ error, strategyId }, 'Error analyzing patterns');
      return [];
    }
  }

  /**
   * Get learned patterns that match current context
   */
  async getMatchingPatterns(
    strategyId: string,
    context: MarketContext,
    marketRegime: string
  ): Promise<LearnedPattern[]> {
    const allPatterns = await this.analyzePatterns(strategyId);
    
    // Filter patterns that match current context
    return allPatterns.filter((pattern) => {
      // Match market regime
      if (pattern.conditions.marketRegime !== 'any' && pattern.conditions.marketRegime !== marketRegime) {
        return false;
      }

      // Match performance context
      const winRate = context.performance.winRate;
      const [minWinRate, maxWinRate] = pattern.conditions.performanceContext.winRateRange;
      if (winRate < minWinRate || winRate > maxWinRate) {
        return false;
      }

      // Match Sharpe if available
      if (pattern.conditions.performanceContext.sharpeRange && context.performance.sharpe) {
        const [minSharpe, maxSharpe] = pattern.conditions.performanceContext.sharpeRange;
        if (context.performance.sharpe < minSharpe || context.performance.sharpe > maxSharpe) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Adjust decision based on learned patterns
   */
  adjustDecisionByLearning(
    decision: Decision,
    patterns: LearnedPattern[]
  ): Decision {
    if (patterns.length === 0) {
      return decision;
    }

    // Find patterns that match the decision action
    const relevantPatterns = patterns.filter(
      (p) => (p.outcome === 'win' && decision.action !== 'flat') || (p.outcome === 'loss' && decision.action !== 'flat')
    );

    if (relevantPatterns.length === 0) {
      return decision;
    }

    // Calculate weighted adjustment
    let confidenceAdjustment = 1.0;
    let positionSizeAdjustment = 1.0;

    for (const pattern of relevantPatterns) {
      if (pattern.outcome === 'win') {
        // Increase confidence if pattern suggests wins
        confidenceAdjustment *= 1 + pattern.confidence * 0.1;
        positionSizeAdjustment *= 1 + pattern.confidence * 0.05;
      } else if (pattern.outcome === 'loss') {
        // Decrease confidence if pattern suggests losses
        confidenceAdjustment *= 1 - pattern.confidence * 0.2;
        positionSizeAdjustment *= 1 - pattern.confidence * 0.15;
      }
    }

    // Apply adjustments
    const adjustedConfidence = Math.max(0, Math.min(1, decision.confidence * confidenceAdjustment));
    const adjustedPositionSize = Math.max(0, decision.targetPositionSizePct * positionSizeAdjustment);

    return {
      ...decision,
      confidence: adjustedConfidence,
      targetPositionSizePct: adjustedPositionSize,
      notes: `${decision.notes || ''}\n[Learning: ${patterns.length} patterns matched, confidence adjusted by ${((confidenceAdjustment - 1) * 100).toFixed(1)}%]`.trim(),
    };
  }

  /**
   * Calculate reward signal for reinforcement learning
   */
  calculateReward(trade: { pnl: number; pnlPct: number; fees: number }): number {
    // Reward function: positive for wins, negative for losses
    // Scale by magnitude of PnL
    const baseReward = trade.pnl > 0 ? 1 : -1;
    const magnitude = Math.abs(trade.pnlPct) / 100; // Normalize to 0-1
    return baseReward * magnitude;
  }
}

export const reinforcementLearning = new ReinforcementLearning();

