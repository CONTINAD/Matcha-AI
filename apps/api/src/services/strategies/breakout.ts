import type { Candle, Decision, Indicators } from '@matcha-ai/shared';
import { detectSupportResistance, calculateSMA } from '../features';
import { logger } from '../../config/logger';

export interface BreakoutConfig {
  volumeMultiplier?: number; // Default: 2.0 (volume must be > this * average)
  minBreakoutPct?: number; // Default: 0.5% (price must break above/below by this %)
  requireConfirmation?: boolean; // Default: true (require confirmation candle)
  lookbackPeriod?: number; // Default: 20 (candles to look back for support/resistance)
}

/**
 * Breakout Strategy
 * 
 * Detects breakouts from support/resistance with volume confirmation:
 * - Support/resistance detection (from features.ts)
 * - Volume spike on breakout (>2x average)
 * - False breakout filter (require confirmation candle)
 * - Entry: Breakout above resistance with volume
 * - Exit: Return to range or stop-loss
 */
export class BreakoutStrategy {
  /**
   * Generate trading decision based on breakout logic
   */
  generateDecision(
    candles: Candle[],
    indicators: Indicators,
    config: BreakoutConfig = {}
  ): Decision | null {
    if (candles.length < 30) {
      return null; // Need enough candles for support/resistance detection
    }

    const volumeMultiplier = config.volumeMultiplier || 2.0;
    const minBreakoutPct = config.minBreakoutPct || 0.5;
    const requireConfirmation = config.requireConfirmation !== false;
    const lookbackPeriod = config.lookbackPeriod || 20;

    // 1. Detect support and resistance levels
    const sr = detectSupportResistance(candles.slice(-lookbackPeriod));
    const support = sr.support;
    const resistance = sr.resistance;

    if (support === 0 || resistance === 0 || support >= resistance) {
      return null; // Invalid support/resistance levels
    }

    const currentPrice = candles[candles.length - 1]?.close || 0;
    const previousPrice = candles[candles.length - 2]?.close || 0;
    if (currentPrice === 0 || previousPrice === 0) return null;

    // 2. Calculate average volume
    const recentCandles = candles.slice(-20);
    const avgVolume = recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length;
    const currentVolume = candles[candles.length - 1]?.volume || 0;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

    // 3. Check for breakout above resistance
    const breakoutAboveResistance =
      previousPrice <= resistance &&
      currentPrice > resistance &&
      (currentPrice - resistance) / resistance >= minBreakoutPct / 100;

    // 4. Check for breakout below support
    const breakoutBelowSupport =
      previousPrice >= support &&
      currentPrice < support &&
      (support - currentPrice) / support >= minBreakoutPct / 100;

    // 5. Volume confirmation
    const volumeConfirmed = volumeRatio > volumeMultiplier;

    // 6. Confirmation candle (if required)
    let confirmationValid = true;
    if (requireConfirmation && candles.length >= 3) {
      const confirmationCandle = candles[candles.length - 2];
      if (breakoutAboveResistance) {
        // For upward breakout, confirmation candle should also be above resistance
        confirmationValid = confirmationCandle.close > resistance;
      } else if (breakoutBelowSupport) {
        // For downward breakout, confirmation candle should also be below support
        confirmationValid = confirmationCandle.close < support;
      }
    }

    let action: 'long' | 'short' | 'flat' = 'flat';
    let confidence = 0.5;
    let positionSize = 5; // Default 5%

    // 7. Generate signals
    if (breakoutAboveResistance && volumeConfirmed && confirmationValid) {
      // Bullish breakout
      action = 'long';
      // Confidence based on breakout strength and volume
      const breakoutStrength = (currentPrice - resistance) / resistance; // How far above resistance
      const volumeStrength = Math.min(1, (volumeRatio - volumeMultiplier) / volumeMultiplier); // 0-1
      confidence = Math.min(
        0.9,
        0.5 + (breakoutStrength * 10 * 0.2) + (volumeStrength * 0.3) // Breakout strength + volume
      );
      positionSize = Math.min(10, 5 + confidence * 5); // 5-10% based on confidence

      logger.info(
        {
          action,
          confidence,
          positionSize,
          currentPrice,
          resistance,
          breakoutStrength: breakoutStrength * 100,
          volumeRatio,
          confirmationValid,
        },
        'Breakout: Long signal (breakout above resistance with volume)'
      );
    } else if (breakoutBelowSupport && volumeConfirmed && confirmationValid) {
      // Bearish breakout
      action = 'short';
      // Confidence based on breakout strength and volume
      const breakoutStrength = (support - currentPrice) / support; // How far below support
      const volumeStrength = Math.min(1, (volumeRatio - volumeMultiplier) / volumeMultiplier); // 0-1
      confidence = Math.min(
        0.9,
        0.5 + (breakoutStrength * 10 * 0.2) + (volumeStrength * 0.3) // Breakout strength + volume
      );
      positionSize = Math.min(10, 5 + confidence * 5);

      logger.info(
        {
          action,
          confidence,
          positionSize,
          currentPrice,
          support,
          breakoutStrength: breakoutStrength * 100,
          volumeRatio,
          confirmationValid,
        },
        'Breakout: Short signal (breakout below support with volume)'
      );
    }

    if (action === 'flat') {
      return null; // No signal
    }

    return {
      action,
      confidence,
      targetPositionSizePct: positionSize,
      notes: `Breakout: ${action} signal, price=${currentPrice.toFixed(2)}, ${action === 'long' ? 'resistance' : 'support'}=${(action === 'long' ? resistance : support).toFixed(2)}, volume=${volumeRatio.toFixed(2)}x`,
    };
  }

  /**
   * Check if breakout is still valid (for exit logic)
   */
  isBreakoutStillValid(
    candles: Candle[],
    indicators: Indicators,
    entrySide: 'long' | 'short',
    entryPrice: number,
    config: BreakoutConfig = {}
  ): boolean {
    const lookbackPeriod = config.lookbackPeriod || 20;
    const sr = detectSupportResistance(candles.slice(-lookbackPeriod));
    const currentPrice = candles[candles.length - 1]?.close || 0;

    if (entrySide === 'long') {
      // Long position: Breakout invalid if price returns below resistance
      if (currentPrice < sr.resistance) {
        return false; // Returned to range
      }
    } else {
      // Short position: Breakout invalid if price returns above support
      if (currentPrice > sr.support) {
        return false; // Returned to range
      }
    }

    return true; // Breakout still valid
  }
}

export const breakoutStrategy = new BreakoutStrategy();

