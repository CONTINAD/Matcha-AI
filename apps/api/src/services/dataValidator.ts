import { logger } from '../config/logger';
import type { Candle } from '@matcha-ai/shared';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Data Validator - Ensures all prices are real (no synthetic data)
 * Validates:
 * - Prices are within reasonable ranges
 * - No data gaps (missing candles)
 * - Rejects obviously fake data (e.g., prices that jump 1000%)
 * - Logs warnings for suspicious data
 */
export class DataValidator {
  private readonly MAX_PRICE_CHANGE_PCT = 50; // 50% max change between candles (reject if higher)
  private readonly MIN_PRICE = 0.000001; // Minimum reasonable price
  private readonly MAX_PRICE = 1000000; // Maximum reasonable price (e.g., $1M per token)

  /**
   * Validate a single candle
   */
  validateCandle(candle: Candle, previousCandle?: Candle): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check price range
    if (candle.close < this.MIN_PRICE || candle.close > this.MAX_PRICE) {
      errors.push(`Price out of range: ${candle.close} (expected ${this.MIN_PRICE} - ${this.MAX_PRICE})`);
    }

    // Check OHLC consistency
    if (candle.high < candle.low) {
      errors.push(`High (${candle.high}) < Low (${candle.low})`);
    }
    if (candle.close > candle.high || candle.close < candle.low) {
      errors.push(`Close (${candle.close}) outside High/Low range [${candle.low}, ${candle.high}]`);
    }
    if (candle.open > candle.high || candle.open < candle.low) {
      errors.push(`Open (${candle.open}) outside High/Low range [${candle.low}, ${candle.high}]`);
    }

    // Check for suspicious price jumps (compared to previous candle)
    if (previousCandle) {
      const priceChangePct = Math.abs((candle.close - previousCandle.close) / previousCandle.close) * 100;
      if (priceChangePct > this.MAX_PRICE_CHANGE_PCT) {
        errors.push(`Suspicious price jump: ${priceChangePct.toFixed(2)}% change (max allowed: ${this.MAX_PRICE_CHANGE_PCT}%)`);
      } else if (priceChangePct > this.MAX_PRICE_CHANGE_PCT * 0.5) {
        warnings.push(`Large price change: ${priceChangePct.toFixed(2)}% (may indicate volatility or data issue)`);
      }
    }

    // Check timestamp
    if (!candle.timestamp || candle.timestamp <= 0) {
      errors.push('Invalid timestamp');
    }

    // Check volume (should be non-negative)
    if (candle.volume < 0) {
      errors.push(`Negative volume: ${candle.volume}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a series of candles
   */
  validateCandles(candles: Candle[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (candles.length === 0) {
      return {
        valid: false,
        errors: ['No candles provided'],
        warnings: [],
      };
    }

    // Validate each candle
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const previousCandle = i > 0 ? candles[i - 1] : undefined;
      const result = this.validateCandle(candle, previousCandle);

      if (!result.valid) {
        errors.push(`Candle ${i} (timestamp: ${new Date(candle.timestamp).toISOString()}): ${result.errors.join(', ')}`);
      }
      warnings.push(...result.warnings.map((w) => `Candle ${i}: ${w}`));
    }

    // Check for data gaps
    const gaps = this.detectGaps(candles);
    if (gaps.length > 0) {
      warnings.push(`Data gaps detected: ${gaps.length} gaps found`);
      gaps.forEach((gap) => {
        warnings.push(`  Gap: ${new Date(gap.start).toISOString()} to ${new Date(gap.end).toISOString()} (${gap.durationMs / 1000 / 60} minutes)`);
      });
    }

    // Check for duplicate timestamps
    const timestamps = candles.map((c) => c.timestamp);
    const duplicates = timestamps.filter((ts, index) => timestamps.indexOf(ts) !== index);
    if (duplicates.length > 0) {
      warnings.push(`Duplicate timestamps found: ${duplicates.length} duplicates`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Detect gaps in candle data
   */
  private detectGaps(candles: Candle[], expectedIntervalMs: number = 3600000): Array<{ start: number; end: number; durationMs: number }> {
    const gaps: Array<{ start: number; end: number; durationMs: number }> = [];

    for (let i = 1; i < candles.length; i++) {
      const prevTimestamp = candles[i - 1].timestamp;
      const currTimestamp = candles[i].timestamp;
      const gap = currTimestamp - prevTimestamp;

      // If gap is more than 2x expected interval, it's a gap
      if (gap > expectedIntervalMs * 2) {
        gaps.push({
          start: prevTimestamp,
          end: currTimestamp,
          durationMs: gap,
        });
      }
    }

    return gaps;
  }

  /**
   * Reject obviously fake data
   */
  rejectFakeData(candles: Candle[]): { valid: boolean; reason?: string } {
    // Check for patterns that indicate synthetic data
    // 1. Perfectly linear prices (too smooth)
    if (candles.length >= 10) {
      const prices = candles.map((c) => c.close);
      const firstPrice = prices[0];
      const lastPrice = prices[prices.length - 1];
      const expectedLinearPrice = firstPrice + ((lastPrice - firstPrice) / (prices.length - 1));
      
      let linearMatches = 0;
      for (let i = 1; i < prices.length - 1; i++) {
        const expected = firstPrice + ((lastPrice - firstPrice) * i) / (prices.length - 1);
        if (Math.abs(prices[i] - expected) < expected * 0.001) { // Within 0.1%
          linearMatches++;
        }
      }
      
      // If more than 80% of prices match linear progression, it's suspicious
      if (linearMatches / (prices.length - 2) > 0.8) {
        return {
          valid: false,
          reason: 'Prices appear to be synthetic (too linear/perfect)',
        };
      }
    }

    // 2. Check for zero or constant prices
    const uniquePrices = new Set(candles.map((c) => c.close));
    if (uniquePrices.size < 3 && candles.length > 10) {
      return {
        valid: false,
        reason: 'Prices appear constant (synthetic data)',
      };
    }

    // 3. Check for unrealistic volatility (all candles have same high/low/close)
    const allSame = candles.every((c) => c.high === c.low && c.low === c.close && c.close === c.open);
    if (allSame && candles.length > 5) {
      return {
        valid: false,
        reason: 'All candles identical (synthetic data)',
      };
    }

    return { valid: true };
  }

  /**
   * Validate and log results
   */
  validateAndLog(candles: Candle[], source: string): boolean {
    const validation = this.validateCandles(candles);
    const fakeCheck = this.rejectFakeData(candles);

    if (!fakeCheck.valid) {
      logger.error({ source, reason: fakeCheck.reason }, 'Rejected fake/synthetic data');
      return false;
    }

    if (!validation.valid) {
      logger.error({ source, errors: validation.errors }, 'Data validation failed');
      return false;
    }

    if (validation.warnings.length > 0) {
      logger.warn({ source, warnings: validation.warnings }, 'Data validation warnings');
    }

    logger.info({ source, candleCount: candles.length }, 'Data validation passed');
    return true;
  }
}

export const dataValidator = new DataValidator();



