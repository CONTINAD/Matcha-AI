import type { Candle, Decision, Indicators } from '@matcha-ai/shared';
import { calculateRSI, calculateMACD, calculateSMA } from '../features';
import { logger } from '../../config/logger';

export interface MomentumConfig {
  rsiPeriod?: number; // Default: 14
  rsiBullish?: number; // Default: 60 (RSI > this = bullish)
  rsiBearish?: number; // Default: 40 (RSI < this = bearish)
  rsiExhaustion?: number; // Default: 80 (RSI > this = momentum exhaustion)
  volumeMultiplier?: number; // Default: 1.5 (volume must be > this * average)
  minMomentumPct?: number; // Default: 1% (price must move > this for signal)
}

/**
 * Momentum Strategy
 * 
 * Uses RSI momentum, MACD momentum, and volume confirmation:
 * - RSI momentum (RSI > 60 = bullish, RSI < 40 = bearish)
 * - MACD momentum (histogram increasing = bullish)
 * - Volume confirmation (volume > 1.5x average)
 * - Price acceleration (rate of change increasing)
 * - Entry: Momentum breakout with volume
 * - Exit: Momentum exhaustion (RSI > 80 or < 20)
 */
export class MomentumStrategy {
  /**
   * Generate trading decision based on momentum logic
   */
  generateDecision(
    candles: Candle[],
    indicators: Indicators,
    config: MomentumConfig = {}
  ): Decision | null {
    if (candles.length < 30) {
      return null; // Need enough candles for momentum calculation
    }

    const rsiPeriod = config.rsiPeriod || 14;
    const rsiBullish = config.rsiBullish || 60;
    const rsiBearish = config.rsiBearish || 40;
    const rsiExhaustion = config.rsiExhaustion || 80;
    const volumeMultiplier = config.volumeMultiplier || 1.5;
    const minMomentumPct = config.minMomentumPct || 1.0;

    // 1. Calculate RSI
    const rsi = indicators.rsi || calculateRSI(candles, rsiPeriod);

    // 2. Check for momentum exhaustion (exit signal)
    if (rsi > rsiExhaustion || rsi < 100 - rsiExhaustion) {
      logger.debug({ rsi, rsiExhaustion }, 'Momentum: RSI at exhaustion level, no new entry');
      return null; // Too extreme, wait for pullback
    }

    // 3. Calculate MACD
    const macd = indicators.macd;
    const macdSignal = indicators.macdSignal;
    const macdHistogram = indicators.macdHistogram;

    // 4. Calculate volume
    const recentCandles = candles.slice(-20);
    const avgVolume = recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length;
    const currentVolume = candles[candles.length - 1]?.volume || 0;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

    // 5. Calculate price momentum (rate of change)
    const priceMomentum = this.calculatePriceMomentum(candles);
    const momentumAcceleration = this.calculateMomentumAcceleration(candles);

    // 6. Determine momentum direction
    const rsiBullishSignal = rsi > rsiBullish && rsi < rsiExhaustion;
    const rsiBearishSignal = rsi < rsiBearish && rsi > 100 - rsiExhaustion;
    const macdBullish = macd && macdSignal && macdHistogram && macd > macdSignal && macdHistogram > 0;
    const macdBearish = macd && macdSignal && macdHistogram && macd < macdSignal && macdHistogram < 0;
    const priceMomentumBullish = priceMomentum > minMomentumPct / 100;
    const priceMomentumBearish = priceMomentum < -minMomentumPct / 100;
    const volumeConfirmed = volumeRatio > volumeMultiplier;

    let action: 'long' | 'short' | 'flat' = 'flat';
    let confidence = 0.5;
    let positionSize = 5; // Default 5%

    // 7. Generate signals
    if (rsiBullishSignal && macdBullish && priceMomentumBullish && volumeConfirmed) {
      // Strong bullish momentum
      action = 'long';
      // Confidence based on signal strength
      const rsiStrength = (rsi - rsiBullish) / (rsiExhaustion - rsiBullish); // 0-1
      const macdStrength = macdHistogram ? Math.min(1, Math.abs(macdHistogram) / 0.01) : 0.5; // Normalized
      const momentumStrength = Math.min(1, Math.abs(priceMomentum) / (minMomentumPct * 2 / 100)); // Normalized
      const volumeStrength = Math.min(1, (volumeRatio - volumeMultiplier) / volumeMultiplier); // 0-1
      const accelerationBonus = momentumAcceleration > 0 ? 0.1 : 0; // Bonus if accelerating

      confidence = Math.min(
        0.9,
        0.5 + (rsiStrength * 0.15 + macdStrength * 0.15 + momentumStrength * 0.1 + volumeStrength * 0.1 + accelerationBonus)
      );
      positionSize = Math.min(10, 5 + confidence * 5); // 5-10% based on confidence

      logger.info(
        {
          action,
          confidence,
          positionSize,
          rsi,
          macdHistogram,
          priceMomentum: priceMomentum * 100,
          volumeRatio,
          momentumAcceleration,
        },
        'Momentum: Long signal (bullish momentum with volume)'
      );
    } else if (rsiBearishSignal && macdBearish && priceMomentumBearish && volumeConfirmed) {
      // Strong bearish momentum
      action = 'short';
      // Confidence based on signal strength (similar to long)
      const rsiStrength = (rsiBearish - rsi) / (rsiBearish - (100 - rsiExhaustion)); // 0-1
      const macdStrength = macdHistogram ? Math.min(1, Math.abs(macdHistogram) / 0.01) : 0.5;
      const momentumStrength = Math.min(1, Math.abs(priceMomentum) / (minMomentumPct * 2 / 100));
      const volumeStrength = Math.min(1, (volumeRatio - volumeMultiplier) / volumeMultiplier);
      const accelerationBonus = momentumAcceleration < 0 ? 0.1 : 0; // Bonus if accelerating down

      confidence = Math.min(
        0.9,
        0.5 + (rsiStrength * 0.15 + macdStrength * 0.15 + momentumStrength * 0.1 + volumeStrength * 0.1 + accelerationBonus)
      );
      positionSize = Math.min(10, 5 + confidence * 5);

      logger.info(
        {
          action,
          confidence,
          positionSize,
          rsi,
          macdHistogram,
          priceMomentum: priceMomentum * 100,
          volumeRatio,
          momentumAcceleration,
        },
        'Momentum: Short signal (bearish momentum with volume)'
      );
    }

    if (action === 'flat') {
      return null; // No signal
    }

    return {
      action,
      confidence,
      targetPositionSizePct: positionSize,
      notes: `Momentum: ${action} signal, RSI=${rsi.toFixed(1)}, MACD=${macdHistogram?.toFixed(4) || 'N/A'}, momentum=${(priceMomentum * 100).toFixed(2)}%, volume=${volumeRatio.toFixed(2)}x`,
    };
  }

  /**
   * Calculate price momentum (rate of change over recent period)
   */
  private calculatePriceMomentum(candles: Candle[], period: number = 5): number {
    if (candles.length < period + 1) return 0;

    const current = candles[candles.length - 1].close;
    const past = candles[candles.length - period - 1].close;

    if (past === 0) return 0;
    return (current - past) / past;
  }

  /**
   * Calculate momentum acceleration (is momentum increasing?)
   */
  private calculateMomentumAcceleration(candles: Candle[]): number {
    if (candles.length < 10) return 0;

    const shortMomentum = this.calculatePriceMomentum(candles, 3);
    const longMomentum = this.calculatePriceMomentum(candles, 7);

    // Acceleration = short momentum - long momentum
    // Positive = accelerating up, Negative = accelerating down
    return shortMomentum - longMomentum;
  }

  /**
   * Check if momentum is still valid (for exit logic)
   */
  isMomentumStillValid(
    candles: Candle[],
    indicators: Indicators,
    entrySide: 'long' | 'short',
    config: MomentumConfig = {}
  ): boolean {
    const rsiPeriod = config.rsiPeriod || 14;
    const rsiExhaustion = config.rsiExhaustion || 80;

    const rsi = indicators.rsi || calculateRSI(candles, rsiPeriod);
    const macd = indicators.macd;
    const macdSignal = indicators.macdSignal;
    const macdHistogram = indicators.macdHistogram;

    if (entrySide === 'long') {
      // Long position: Momentum invalid if:
      // 1. RSI > exhaustion level (overbought)
      // 2. MACD histogram turns negative (momentum weakening)
      if (rsi > rsiExhaustion) {
        return false; // Overbought
      }
      if (macd && macdSignal && macdHistogram && macdHistogram < 0) {
        return false; // Momentum weakening
      }
    } else {
      // Short position: Momentum invalid if:
      // 1. RSI < (100 - exhaustion) (oversold)
      // 2. MACD histogram turns positive (momentum weakening)
      if (rsi < 100 - rsiExhaustion) {
        return false; // Oversold
      }
      if (macd && macdSignal && macdHistogram && macdHistogram > 0) {
        return false; // Momentum weakening
      }
    }

      return true; // Momentum still valid
    }
}

export const momentumStrategy = new MomentumStrategy();

