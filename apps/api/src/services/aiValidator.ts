import type { Decision, RiskLimits, MarketContext } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { aiValidatorRejections } from './metrics';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  adjustedDecision?: Decision;
}

/**
 * AI Decision Validator
 * 
 * Validates AI decisions against risk limits before accepting:
 * - Check position size against max allowed
 * - Reject if confidence too low (< 0.3)
 * - Reject if action conflicts with recent performance (losing streak = no new positions)
 */
export class AIValidator {
  /**
   * Validate AI decision
   */
  validateDecision(
    decision: Decision,
    context: MarketContext,
    riskLimits: RiskLimits
  ): ValidationResult {
    // 1. Check confidence threshold
    if (decision.confidence < 0.3) {
      aiValidatorRejections.inc({ reason: 'low_confidence' });
      return {
        valid: false,
        reason: `Confidence too low: ${decision.confidence} < 0.3`,
      };
    }

    // 2. Check position size against max allowed
    if (decision.targetPositionSizePct > riskLimits.maxPositionPct) {
      logger.warn(
        {
          requestedSize: decision.targetPositionSizePct,
          maxSize: riskLimits.maxPositionPct,
        },
        'AI decision exceeds max position size, clamping'
      );
      return {
        valid: true,
        reason: 'Position size clamped to max',
        adjustedDecision: {
          ...decision,
          targetPositionSizePct: riskLimits.maxPositionPct,
        },
      };
    }

    // 3. Check if action conflicts with recent performance
    const recentTrades = context.performance.totalTrades || 0;
    const winRate = context.performance.winRate || 0;
    const losingStreak = this.calculateLosingStreak(context);

    // If losing streak > 3 and win rate < 40%, reject new positions
    if (losingStreak > 3 && winRate < 0.4 && recentTrades >= 5 && decision.action !== 'flat') {
      aiValidatorRejections.inc({ reason: 'losing_streak' });
      return {
        valid: false,
        reason: `Losing streak (${losingStreak}) and low win rate (${(winRate * 100).toFixed(1)}%), rejecting new positions`,
      };
    }

    // 4. Check daily loss limit
    const dailyLossPct = context.currentEquity > 0
      ? (Math.abs(Math.min(0, context.dailyPnl)) / context.currentEquity) * 100
      : 0;

    if (dailyLossPct >= riskLimits.maxDailyLossPct && decision.action !== 'flat') {
      aiValidatorRejections.inc({ reason: 'daily_loss' });
      return {
        valid: false,
        reason: `Daily loss limit exceeded: ${dailyLossPct.toFixed(2)}% >= ${riskLimits.maxDailyLossPct}%`,
      };
    }

    // 5. Check drawdown limit
    if (riskLimits.maxDrawdownPct !== undefined) {
      const drawdownPct = context.performance.maxDrawdown || 0;
      if (drawdownPct >= riskLimits.maxDrawdownPct && decision.action !== 'flat') {
        aiValidatorRejections.inc({ reason: 'drawdown' });
        return {
          valid: false,
          reason: `Max drawdown exceeded: ${drawdownPct.toFixed(2)}% >= ${riskLimits.maxDrawdownPct}%`,
        };
      }
    }

    // 6. Validate action is valid
    if (!['long', 'short', 'flat'].includes(decision.action)) {
      return {
        valid: false,
        reason: `Invalid action: ${decision.action}`,
      };
    }

    // 7. Validate confidence range
    if (decision.confidence < 0 || decision.confidence > 1) {
      return {
        valid: false,
        reason: `Invalid confidence: ${decision.confidence} (must be 0-1)`,
      };
    }

    // 8. Validate position size range
    if (decision.targetPositionSizePct < 0 || decision.targetPositionSizePct > 100) {
      return {
        valid: false,
        reason: `Invalid position size: ${decision.targetPositionSizePct}% (must be 0-100)`,
      };
    }

    // All checks passed
    return {
      valid: true,
    };
  }

  /**
   * Calculate losing streak from context
   * (Simplified - would need trade history for accurate calculation)
   */
  private calculateLosingStreak(context: MarketContext): number {
    // If win rate is low and recent performance is negative, estimate losing streak
    const winRate = context.performance.winRate || 0;
    const totalTrades = context.performance.totalTrades || 0;
    const dailyPnl = context.dailyPnl || 0;

    if (totalTrades === 0) return 0;

    // Estimate losing streak based on win rate and daily PnL
    if (winRate < 0.4 && dailyPnl < 0) {
      // Low win rate + negative daily PnL = likely losing streak
      const estimatedLosses = totalTrades * (1 - winRate);
      return Math.min(5, Math.ceil(estimatedLosses / 2)); // Conservative estimate
    }

    return 0;
  }

  /**
   * Adjust decision to be safe (reduce position size, lower confidence)
   */
  adjustDecisionForSafety(
    decision: Decision,
    riskLimits: RiskLimits,
    context: MarketContext
  ): Decision {
    let adjustedSize = decision.targetPositionSizePct;
    let adjustedConfidence = decision.confidence;

    // Reduce position size if volatility is high
    const volatility = context.indicators.volatility || 0;
    const price = context.recentCandles[context.recentCandles.length - 1]?.close || 1;
    const volatilityPct = price > 0 ? (volatility / price) * 100 : 0;

    if (volatilityPct > 2.0) {
      // High volatility: Reduce position by 50%
      adjustedSize = adjustedSize * 0.5;
      logger.debug(
        {
          originalSize: decision.targetPositionSizePct,
          adjustedSize,
          volatilityPct,
        },
        'Reduced position size due to high volatility'
      );
    }

    // Reduce confidence if recent performance is poor
    const winRate = context.performance.winRate || 0;
    if (winRate < 0.45 && (context.performance.totalTrades || 0) >= 10) {
      adjustedConfidence = adjustedConfidence * 0.8;
      logger.debug(
        {
          originalConfidence: decision.confidence,
          adjustedConfidence,
          winRate,
        },
        'Reduced confidence due to poor recent performance'
      );
    }

    return {
      ...decision,
      targetPositionSizePct: Math.min(adjustedSize, riskLimits.maxPositionPct),
      confidence: Math.max(0.3, adjustedConfidence),
      notes: `${decision.notes || ''} [Adjusted for safety]`.trim(),
    };
  }
}

export const aiValidator = new AIValidator();

