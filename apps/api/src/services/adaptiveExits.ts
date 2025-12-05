import type { Candle, Position, RiskLimits } from '@matcha-ai/shared';
import type { Indicators } from './features';
import { detectTrendRegime, detectVolatilityRegime, calculateADX } from './features';
import { logger } from '../config/logger';
import { adaptiveExitTriggers } from './metrics';

export interface AdaptiveExitConfig {
  baseTakeProfitPct?: number; // Default from riskLimits
  baseStopLossPct?: number; // Default from riskLimits
  minTakeProfitPct?: number; // Minimum take-profit (default: 2%)
  maxTakeProfitPct?: number; // Maximum take-profit (default: 10%)
  minStopLossPct?: number; // Minimum stop-loss (default: 1%)
  maxStopLossPct?: number; // Maximum stop-loss (default: 5%)
}

export interface AdaptiveExitTargets {
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct?: number;
  trailingStopActivationPct?: number;
  holdTimeMinutes?: number; // Recommended hold time in strong trends
}

/**
 * Adaptive Exits Service
 * 
 * Adjusts take-profit and stop-loss based on:
 * - Trend strength: Strong trend = higher take-profit (6% vs 4%)
 * - Volatility: High volatility = wider take-profit (5% vs 3%)
 * - Time-based: Hold longer in strong trends (trailing stop activates later)
 * - Performance-based: If recent trades hitting take-profit early, increase target
 */
export class AdaptiveExits {
  /**
   * Calculate adaptive exit targets based on market conditions
   */
  calculateExitTargets(
    position: Position,
    candles: Candle[],
    indicators: Indicators,
    riskLimits: RiskLimits,
    config: AdaptiveExitConfig = {},
    recentPerformance?: {
      avgHoldTime?: number;
      earlyTakeProfitRate?: number; // % of trades that hit TP early
      avgTakeProfitPct?: number;
    }
  ): AdaptiveExitTargets {
    const baseTakeProfit = config.baseTakeProfitPct || riskLimits.takeProfitPct || 4;
    const baseStopLoss = config.baseStopLossPct || riskLimits.stopLossPct || 2;
    const minTakeProfit = config.minTakeProfitPct || 2;
    const maxTakeProfit = config.maxTakeProfitPct || 10;
    const minStopLoss = config.minStopLossPct || 1;
    const maxStopLoss = config.maxStopLossPct || 5;

    // 1. Trend strength adjustment
    const trendRegime = detectTrendRegime(candles, indicators);
    const adx = indicators.adx || calculateADX(candles);
    const trendStrength = adx > 25 ? Math.min(1, adx / 50) : 0.5; // Normalize ADX to 0-1

    // Strong trend: Increase take-profit, decrease stop-loss (let winners run)
    let trendAdjustedTakeProfit = baseTakeProfit;
    let trendAdjustedStopLoss = baseStopLoss;

    if (trendRegime === 'trending' && trendStrength > 0.6) {
      // Strong trend: 50% higher take-profit, 25% tighter stop-loss
      trendAdjustedTakeProfit = baseTakeProfit * 1.5;
      trendAdjustedStopLoss = baseStopLoss * 0.75;
      adaptiveExitTriggers.inc({ exit_type: 'take_profit', adjustment_type: 'trend' });
      adaptiveExitTriggers.inc({ exit_type: 'stop_loss', adjustment_type: 'trend' });
      logger.debug(
        {
          trendRegime,
          trendStrength,
          baseTakeProfit,
          trendAdjustedTakeProfit,
          baseStopLoss,
          trendAdjustedStopLoss,
          adjustmentType: 'trend',
        },
        'Adaptive exits: Strong trend detected, increasing take-profit'
      );
    } else if (trendRegime === 'ranging') {
      // Ranging market: Tighter take-profit, wider stop-loss (mean reversion)
      trendAdjustedTakeProfit = baseTakeProfit * 0.8;
      trendAdjustedStopLoss = baseStopLoss * 1.2;
      logger.debug(
        {
          trendRegime,
          baseTakeProfit,
          trendAdjustedTakeProfit,
          baseStopLoss,
          trendAdjustedStopLoss,
        },
        'Adaptive exits: Ranging market, tightening take-profit'
      );
    }

    // 2. Volatility adjustment
    const volRegime = detectVolatilityRegime(candles, indicators);
    const atr = indicators.volatility || 0;
    const price = candles[candles.length - 1]?.close || 1;
    const atrPct = price > 0 ? (atr / price) * 100 : 0;

    let volatilityAdjustedTakeProfit = trendAdjustedTakeProfit;
    let volatilityAdjustedStopLoss = trendAdjustedStopLoss;

    if (volRegime === 'high' || atrPct > 2.0) {
      // High volatility: Wider take-profit and stop-loss
      volatilityAdjustedTakeProfit = trendAdjustedTakeProfit * 1.25;
      volatilityAdjustedStopLoss = trendAdjustedStopLoss * 1.25;
      adaptiveExitTriggers.inc({ exit_type: 'take_profit', adjustment_type: 'volatility' });
      adaptiveExitTriggers.inc({ exit_type: 'stop_loss', adjustment_type: 'volatility' });
      logger.debug(
        {
          volRegime,
          atrPct,
          trendAdjustedTakeProfit,
          volatilityAdjustedTakeProfit,
          trendAdjustedStopLoss,
          volatilityAdjustedStopLoss,
          adjustmentType: 'volatility',
        },
        'Adaptive exits: High volatility, widening targets'
      );
    } else if (volRegime === 'low' || atrPct < 0.5) {
      // Low volatility: Tighter take-profit and stop-loss
      volatilityAdjustedTakeProfit = trendAdjustedTakeProfit * 0.9;
      volatilityAdjustedStopLoss = trendAdjustedStopLoss * 0.9;
      logger.debug(
        {
          volRegime,
          atrPct,
          trendAdjustedTakeProfit,
          volatilityAdjustedTakeProfit,
          trendAdjustedStopLoss,
          volatilityAdjustedStopLoss,
        },
        'Adaptive exits: Low volatility, tightening targets'
      );
    }

    // 3. Performance-based adjustment
    let performanceAdjustedTakeProfit = volatilityAdjustedTakeProfit;
    if (recentPerformance?.earlyTakeProfitRate && recentPerformance.earlyTakeProfitRate > 0.7) {
      // If 70%+ of trades hit TP early, increase target
      performanceAdjustedTakeProfit = volatilityAdjustedTakeProfit * 1.2;
      adaptiveExitTriggers.inc({ exit_type: 'take_profit', adjustment_type: 'performance' });
      logger.debug(
        {
          earlyTakeProfitRate: recentPerformance.earlyTakeProfitRate,
          volatilityAdjustedTakeProfit,
          performanceAdjustedTakeProfit,
          adjustmentType: 'performance',
        },
        'Adaptive exits: Many trades hitting TP early, increasing target'
      );
    }

    // 4. Clamp to min/max
    const finalTakeProfit = Math.max(
      minTakeProfit,
      Math.min(maxTakeProfit, performanceAdjustedTakeProfit)
    );
    const finalStopLoss = Math.max(
      minStopLoss,
      Math.min(maxStopLoss, volatilityAdjustedStopLoss)
    );

    // 5. Calculate trailing stop
    let trailingStopPct = riskLimits.trailingStopPct;
    let trailingStopActivationPct = riskLimits.trailingStopActivationPct;

    // In strong trends, activate trailing stop later (let winners run)
    if (trendRegime === 'trending' && trendStrength > 0.6) {
      trailingStopActivationPct = (trailingStopActivationPct || 2) * 1.5; // Activate at 3% instead of 2%
      trailingStopPct = (trailingStopPct || 1.5) * 1.2; // Wider trailing stop (1.8% instead of 1.5%)
    }

    // 6. Calculate recommended hold time
    let holdTimeMinutes: number | undefined;
    if (trendRegime === 'trending' && trendStrength > 0.6) {
      // Strong trend: Hold longer (up to 4 hours for 5m timeframe)
      holdTimeMinutes = 240; // 4 hours
    } else if (trendRegime === 'ranging') {
      // Ranging: Quick exits (30 minutes for 5m timeframe)
      holdTimeMinutes = 30;
    }

    logger.info(
      {
        position: position.symbol,
        side: position.side,
        finalTakeProfit,
        finalStopLoss,
        trailingStopPct,
        trailingStopActivationPct,
        holdTimeMinutes,
        trendRegime,
        volRegime,
        trendStrength,
      },
      'Calculated adaptive exit targets'
    );

    return {
      takeProfitPct: finalTakeProfit,
      stopLossPct: finalStopLoss,
      trailingStopPct,
      trailingStopActivationPct,
      holdTimeMinutes,
    };
  }

  /**
   * Check if position should be held longer based on trend strength
   */
  shouldHoldLonger(
    position: Position,
    candles: Candle[],
    indicators: Indicators,
    currentPnlPct: number
  ): boolean {
    const trendRegime = detectTrendRegime(candles, indicators);
    const adx = indicators.adx || calculateADX(candles);
    const trendStrength = adx > 25 ? Math.min(1, adx / 50) : 0.5;

    // In strong trends, hold longer if we're in profit
    if (trendRegime === 'trending' && trendStrength > 0.6 && currentPnlPct > 2) {
      return true; // Hold longer in strong trends when profitable
    }

    return false;
  }
}

export const adaptiveExits = new AdaptiveExits();

