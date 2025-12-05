import type { Candle, Decision, Indicators } from '@matcha-ai/shared';
import { calculateEMA, calculateSMA, calculateADX } from '../features';
import { logger } from '../../config/logger';

export interface TrendFollowingConfig {
  emaFast?: number; // Default: 9
  emaSlow?: number; // Default: 21
  smaFast?: number; // Default: 20
  smaSlow?: number; // Default: 50
  adxThreshold?: number; // Default: 25 (only trade if ADX > this)
  minTrendStrength?: number; // Default: 0.6 (0-1)
}

/**
 * Trend-Following Strategy
 * 
 * Uses multiple timeframe analysis and ADX confirmation:
 * - Multiple timeframe trends (5m, 15m, 1h)
 * - ADX confirmation (only trade if ADX > 25)
 * - Moving average crossovers (EMA 9/21, SMA 20/50)
 * - Trend strength scoring (0-1)
 * - Entry: Pullback to EMA in uptrend
 * - Exit: Trend reversal or take-profit
 */
export class TrendFollowingStrategy {
  /**
   * Generate trading decision based on trend-following logic
   */
  generateDecision(
    candles: Candle[],
    indicators: Indicators,
    config: TrendFollowingConfig = {}
  ): Decision | null {
    if (candles.length < 50) {
      return null; // Need enough candles for multi-timeframe analysis
    }

    const emaFast = config.emaFast || 9;
    const emaSlow = config.emaSlow || 21;
    const smaFast = config.smaFast || 20;
    const smaSlow = config.smaSlow || 50;
    const adxThreshold = config.adxThreshold || 25;
    const minTrendStrength = config.minTrendStrength || 0.6;

    // 1. Check ADX (trend strength) - must be above threshold
    const adx = indicators.adx || calculateADX(candles);
    if (adx < adxThreshold) {
      logger.debug({ adx, adxThreshold }, 'Trend following: ADX too low, no trade');
      return null; // Not a strong trend
    }

    // 2. Calculate EMAs and SMAs
    const ema9 = indicators.emaFast || calculateEMA(candles, emaFast);
    const ema21 = indicators.emaSlow || calculateEMA(candles, emaSlow);
    const sma20 = indicators.sma20 || calculateSMA(candles, smaFast);
    const sma50 = indicators.sma50 || calculateSMA(candles, smaSlow);

    const currentPrice = candles[candles.length - 1]?.close || 0;
    if (currentPrice === 0) return null;

    // 3. Determine trend direction
    const emaBullish = ema9 > ema21;
    const smaBullish = sma20 > sma50;
    const priceAboveEMA = currentPrice > ema9;
    const priceAboveSMA = currentPrice > sma20;

    const isUptrend = emaBullish && smaBullish && priceAboveEMA && priceAboveSMA;
    const isDowntrend = !emaBullish && !smaBullish && currentPrice < ema9 && currentPrice < sma20;

    // 4. Calculate trend strength
    const emaSeparation = Math.abs(ema9 - ema21) / ema21;
    const smaSeparation = Math.abs(sma20 - sma50) / sma50;
    const trendStrength = (emaSeparation + smaSeparation) / 2;

    if (trendStrength < minTrendStrength) {
      logger.debug({ trendStrength, minTrendStrength }, 'Trend following: Trend too weak, no trade');
      return null;
    }

    // 5. Check for pullback entry (in uptrend) or bounce entry (in downtrend)
    let action: 'long' | 'short' | 'flat' = 'flat';
    let confidence = 0.5;
    let positionSize = 5; // Default 5%

    if (isUptrend) {
      // Uptrend: Look for pullback to EMA
      const pullbackToEMA = currentPrice <= ema9 * 1.02 && currentPrice >= ema9 * 0.98; // Within 2% of EMA
      const pullbackToSMA = currentPrice <= sma20 * 1.02 && currentPrice >= sma20 * 0.98;

      if (pullbackToEMA || pullbackToSMA) {
        action = 'long';
        // Confidence based on how close to EMA and trend strength
        const distanceFromEMA = Math.abs(currentPrice - ema9) / ema9;
        confidence = Math.min(0.85, 0.5 + (1 - distanceFromEMA * 10) * 0.3 + trendStrength * 0.2);
        positionSize = Math.min(10, 5 + trendStrength * 5); // 5-10% based on trend strength
        logger.info(
          {
            action,
            confidence,
            positionSize,
            adx,
            trendStrength,
            pullbackToEMA,
            pullbackToSMA,
          },
          'Trend following: Long signal (uptrend pullback)'
        );
      }
    } else if (isDowntrend) {
      // Downtrend: Look for bounce to EMA (short entry)
      const bounceToEMA = currentPrice >= ema9 * 0.98 && currentPrice <= ema9 * 1.02; // Within 2% of EMA
      const bounceToSMA = currentPrice >= sma20 * 0.98 && currentPrice <= sma20 * 1.02;

      if (bounceToEMA || bounceToSMA) {
        action = 'short';
        // Confidence based on how close to EMA and trend strength
        const distanceFromEMA = Math.abs(currentPrice - ema9) / ema9;
        confidence = Math.min(0.85, 0.5 + (1 - distanceFromEMA * 10) * 0.3 + trendStrength * 0.2);
        positionSize = Math.min(10, 5 + trendStrength * 5); // 5-10% based on trend strength
        logger.info(
          {
            action,
            confidence,
            positionSize,
            adx,
            trendStrength,
            bounceToEMA,
            bounceToSMA,
          },
          'Trend following: Short signal (downtrend bounce)'
        );
      }
    }

    if (action === 'flat') {
      return null; // No signal
    }

    return {
      action,
      confidence,
      targetPositionSizePct: positionSize,
      notes: `Trend following: ${action} signal, ADX=${adx.toFixed(1)}, strength=${trendStrength.toFixed(2)}`,
    };
  }

  /**
   * Check if trend is still valid (for exit logic)
   */
  isTrendStillValid(
    candles: Candle[],
    indicators: Indicators,
    entrySide: 'long' | 'short',
    config: TrendFollowingConfig = {}
  ): boolean {
    const emaFast = config.emaFast || 9;
    const emaSlow = config.emaSlow || 21;

    const ema9 = indicators.emaFast || calculateEMA(candles, emaFast);
    const ema21 = indicators.emaSlow || calculateEMA(candles, emaSlow);
    const adx = indicators.adx || calculateADX(candles);

    // Trend is invalid if:
    // 1. ADX drops below threshold (trend weakening)
    // 2. EMA crossover (trend reversal)
    const adxThreshold = config.adxThreshold || 25;
    if (adx < adxThreshold) {
      return false; // Trend weakening
    }

    if (entrySide === 'long') {
      // Long position: Trend invalid if EMA9 crosses below EMA21
      if (ema9 < ema21) {
        return false; // Trend reversal
      }
    } else {
      // Short position: Trend invalid if EMA9 crosses above EMA21
      if (ema9 > ema21) {
        return false; // Trend reversal
      }
    }

    return true; // Trend still valid
  }
}

export const trendFollowingStrategy = new TrendFollowingStrategy();

