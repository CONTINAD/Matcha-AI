import type { Decision, Trade, MarketContext } from '@matcha-ai/shared';
import { detectTrendRegime, detectVolatilityRegime } from './features';
import { logger } from '../config/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AIEvaluation {
  decision: Decision;
  trade: Trade;
  aiWasRight: boolean;
  reason: string;
  marketRegime: string;
  volatilityRegime: string;
  confidence: number;
  actualPnl: number;
  expectedPnl?: number;
  timestamp: number;
}

/**
 * AI Self-Evaluation Service
 * 
 * Tracks when AI was right/wrong and why:
 * - After trade closes, evaluate if AI decision was correct
 * - Track: Was AI right? Why/why not?
 * - Adjust AI usage: If AI wrong > 60%, reduce usage
 * - Learn patterns: "AI is wrong in volatile markets" → don't use AI in volatility
 */
export class AIEvaluator {
  private evaluations: Map<string, AIEvaluation[]> = new Map(); // strategyId -> evaluations

  /**
   * Evaluate AI decision after trade closes
   */
  async evaluateDecision(
    strategyId: string,
    decision: Decision,
    trade: Trade,
    contextAtEntry: MarketContext,
    contextAtExit?: MarketContext
  ): Promise<AIEvaluation> {
    const marketRegime = detectTrendRegime(contextAtEntry.recentCandles, contextAtEntry.indicators);
    const volRegime = detectVolatilityRegime(contextAtEntry.recentCandles, contextAtEntry.indicators);

    // Determine if AI was right
    const aiWasRight = this.wasDecisionCorrect(decision, trade);

    // Calculate reason
    const reason = this.calculateReason(decision, trade, contextAtEntry, contextAtExit);

    const evaluation: AIEvaluation = {
      decision,
      trade,
      aiWasRight,
      reason,
      marketRegime,
      volatilityRegime: volRegime,
      confidence: decision.confidence,
      actualPnl: trade.pnl,
      timestamp: Date.now(),
    };

    // Store evaluation
    const evaluations = this.evaluations.get(strategyId) || [];
    evaluations.push(evaluation);
    this.evaluations.set(strategyId, evaluations);

    // Store in database for persistence
    try {
      await prisma.prediction.updateMany({
        where: {
          strategyId,
          timestamp: {
            gte: new Date(trade.timestamp - 60000), // Within 1 minute of trade
            lte: new Date(trade.timestamp + 60000),
          },
        },
        data: {
          // Store evaluation in prediction metadata (would need to add field to schema)
        },
      });
    } catch (error) {
      logger.warn({ error, strategyId }, 'Failed to store AI evaluation in database');
    }

    logger.info(
      {
        strategyId,
        aiWasRight,
        reason,
        marketRegime,
        volRegime,
        confidence: decision.confidence,
        actualPnl: trade.pnl,
      },
      'AI decision evaluated'
    );

    return evaluation;
  }

  /**
   * Determine if AI decision was correct
   */
  private wasDecisionCorrect(decision: Decision, trade: Trade): boolean {
    // AI was right if:
    // 1. Decision was long and trade was profitable
    // 2. Decision was short and trade was profitable
    // 3. Decision was flat and no trade was made (or trade was small/unprofitable)

    if (decision.action === 'flat') {
      // Flat decision: Right if no significant trade or trade was unprofitable
      return trade.pnl <= 0 || Math.abs(trade.size) < 0.01;
    }

    if (decision.action === 'long') {
      // Long decision: Right if trade was profitable
      return trade.pnl > 0;
    }

    if (decision.action === 'short') {
      // Short decision: Right if trade was profitable
      return trade.pnl > 0;
    }

    return false;
  }

  /**
   * Calculate reason for AI being right/wrong
   */
  private calculateReason(
    decision: Decision,
    trade: Trade,
    contextAtEntry: MarketContext,
    contextAtExit?: MarketContext
  ): string {
    const reasons: string[] = [];

    if (trade.pnl > 0) {
      reasons.push('Trade was profitable');
    } else {
      reasons.push('Trade was unprofitable');
    }

    // Check if market regime changed
    if (contextAtExit) {
      const entryRegime = detectTrendRegime(contextAtEntry.recentCandles, contextAtEntry.indicators);
      const exitRegime = detectTrendRegime(contextAtExit.recentCandles, contextAtExit.indicators);

      if (entryRegime !== exitRegime) {
        reasons.push(`Market regime changed: ${entryRegime} → ${exitRegime}`);
      }
    }

    // Check confidence vs outcome
    if (decision.confidence > 0.7 && trade.pnl < 0) {
      reasons.push('High confidence but trade lost');
    } else if (decision.confidence < 0.5 && trade.pnl > 0) {
      reasons.push('Low confidence but trade won');
    }

    // Check position size
    const actualSizePct = contextAtEntry.currentEquity > 0
      ? (Math.abs(trade.size * trade.entryPrice) / contextAtEntry.currentEquity) * 100
      : 0;

    if (actualSizePct > decision.targetPositionSizePct * 1.2) {
      reasons.push('Position size was larger than recommended');
    } else if (actualSizePct < decision.targetPositionSizePct * 0.5) {
      reasons.push('Position size was smaller than recommended');
    }

    return reasons.join('; ');
  }

  /**
   * Get AI accuracy by market regime
   */
  getAccuracyByRegime(strategyId: string): {
    [regime: string]: { correct: number; total: number; accuracy: number };
  } {
    const evaluations = this.evaluations.get(strategyId) || [];
    const byRegime: { [regime: string]: { correct: number; total: number } } = {};

    for (const eval_ of evaluations) {
      const regime = `${eval_.marketRegime}-${eval_.volatilityRegime}`;
      if (!byRegime[regime]) {
        byRegime[regime] = { correct: 0, total: 0 };
      }
      byRegime[regime].total++;
      if (eval_.aiWasRight) {
        byRegime[regime].correct++;
      }
    }

    const result: { [regime: string]: { correct: number; total: number; accuracy: number } } = {};
    for (const [regime, stats] of Object.entries(byRegime)) {
      result[regime] = {
        ...stats,
        accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
      };
    }

    return result;
  }

  /**
   * Get overall AI accuracy
   */
  getOverallAccuracy(strategyId: string, minEvaluations: number = 10): {
    accuracy: number;
    total: number;
    correct: number;
    shouldUseAI: boolean;
  } {
    const evaluations = this.evaluations.get(strategyId) || [];
    const total = evaluations.length;
    const correct = evaluations.filter((e) => e.aiWasRight).length;
    const accuracy = total > 0 ? correct / total : 0;

    // Don't use AI if accuracy < 50% and we have enough evaluations
    const shouldUseAI = total < minEvaluations || accuracy >= 0.5;

    return {
      accuracy,
      total,
      correct,
      shouldUseAI,
    };
  }

  /**
   * Get recommendations for AI usage by regime
   */
  getAIUsageRecommendations(strategyId: string): {
    [regime: string]: 'use' | 'avoid' | 'reduce';
  } {
    const accuracyByRegime = this.getAccuracyByRegime(strategyId);
    const recommendations: { [regime: string]: 'use' | 'avoid' | 'reduce' } = {};

    for (const [regime, stats] of Object.entries(accuracyByRegime)) {
      if (stats.total < 5) {
        recommendations[regime] = 'use'; // Not enough data, use AI
      } else if (stats.accuracy < 0.5) {
        recommendations[regime] = 'avoid'; // AI wrong > 50%, avoid
      } else if (stats.accuracy < 0.6) {
        recommendations[regime] = 'reduce'; // AI accuracy 50-60%, reduce usage
      } else {
        recommendations[regime] = 'use'; // AI accuracy > 60%, use
      }
    }

    return recommendations;
  }

  /**
   * Clear evaluations for a strategy
   */
  clearEvaluations(strategyId: string): void {
    this.evaluations.delete(strategyId);
    logger.debug({ strategyId }, 'AI evaluations cleared');
  }
}

export const aiEvaluator = new AIEvaluator();

