import type { Candle, Indicators } from '@matcha-ai/shared';
import { detectTrendRegime, detectVolatilityRegime } from './features';
import { logger } from '../config/logger';
import { slippageCalculations } from './metrics';

export interface SlippageContext {
  candles: Candle[];
  indicators: Indicators;
  tradeSize: number; // in USD
  baseSlippageBps?: number; // default base slippage in basis points
  timeOfDay?: number; // hour of day (0-23)
}

/**
 * Slippage Manager
 * 
 * Calculates dynamic slippage tolerance based on:
 * - Volatility (ATR-based): Higher volatility = higher slippage
 * - Time of day: Low liquidity hours = higher slippage
 * - Trade size: Larger trades = higher slippage
 * - Market regime: Ranging = lower, Volatile = higher
 */
export class SlippageManager {
  private readonly DEFAULT_BASE_SLIPPAGE_BPS = 50; // 0.5% default
  private readonly MIN_SLIPPAGE_BPS = 10; // 0.1% minimum
  private readonly MAX_SLIPPAGE_BPS = 200; // 2% maximum

  /**
   * Calculate dynamic slippage tolerance
   */
  calculateSlippage(context: SlippageContext): number {
    const baseSlippage = context.baseSlippageBps || this.DEFAULT_BASE_SLIPPAGE_BPS;
    
    // 1. Volatility adjustment
    const volatilityMultiplier = this.getVolatilityMultiplier(context);
    
    // 2. Time-based adjustment
    const timeMultiplier = this.getTimeMultiplier(context.timeOfDay);
    
    // 3. Size-based adjustment
    const sizeMultiplier = this.getSizeMultiplier(context.tradeSize);
    
    // 4. Regime-based adjustment
    const regimeMultiplier = this.getRegimeMultiplier(context);

    // Combine all multipliers
    const adjustedSlippage = baseSlippage * volatilityMultiplier * timeMultiplier * sizeMultiplier * regimeMultiplier;

    // Clamp to min/max
    const finalSlippage = Math.max(
      this.MIN_SLIPPAGE_BPS,
      Math.min(this.MAX_SLIPPAGE_BPS, Math.round(adjustedSlippage))
    );

    // Record metrics
    const trendRegime = detectTrendRegime(context.candles, context.indicators);
    const volRegime = detectVolatilityRegime(context.candles, context.indicators);
    slippageCalculations.observe(
      { regime: trendRegime, volatility_regime: volRegime },
      finalSlippage
    );

    logger.debug(
      {
        baseSlippage,
        volatilityMultiplier,
        timeMultiplier,
        sizeMultiplier,
        regimeMultiplier,
        finalSlippage,
        tradeSize: context.tradeSize,
        trendRegime,
        volRegime,
      },
      'Calculated dynamic slippage'
    );

    return finalSlippage;
  }

  /**
   * Get volatility multiplier based on ATR
   * Higher volatility = higher slippage tolerance
   */
  private getVolatilityMultiplier(context: SlippageContext): number {
    const atr = context.indicators.volatility || 0;
    const price = context.candles[context.candles.length - 1]?.close || 1;
    
    if (price === 0) return 1.0;

    // Calculate ATR as percentage of price
    const atrPct = (atr / price) * 100;

    // Volatility thresholds:
    // Low (< 0.5%): 0.8x (tighter slippage)
    // Medium (0.5-2%): 1.0x (normal)
    // High (> 2%): 1.5x (wider slippage)
    if (atrPct < 0.5) {
      return 0.8;
    } else if (atrPct > 2.0) {
      return 1.5;
    }

    return 1.0;
  }

  /**
   * Get time-based multiplier
   * Low liquidity hours (late night/early morning) = higher slippage
   */
  private getTimeMultiplier(hour?: number): number {
    if (hour === undefined) {
      hour = new Date().getUTCHours();
    }

    // Low liquidity hours: 0-4 UTC (late night US, early morning EU)
    // High liquidity hours: 12-20 UTC (US/EU overlap)
    if (hour >= 0 && hour < 4) {
      return 1.3; // 30% higher slippage during low liquidity
    } else if (hour >= 12 && hour < 20) {
      return 0.9; // 10% lower slippage during high liquidity
    }

    return 1.0; // Normal hours
  }

  /**
   * Get size-based multiplier
   * Larger trades = higher slippage tolerance
   */
  private getSizeMultiplier(tradeSize: number): number {
    // Size thresholds:
    // Small (< $100): 0.9x (tighter slippage)
    // Medium ($100-$1000): 1.0x (normal)
    // Large ($1000-$10000): 1.2x (wider slippage)
    // Very large (> $10000): 1.5x (much wider slippage)
    if (tradeSize < 100) {
      return 0.9;
    } else if (tradeSize > 10000) {
      return 1.5;
    } else if (tradeSize > 1000) {
      return 1.2;
    }

    return 1.0;
  }

  /**
   * Get regime-based multiplier
   * Ranging markets = lower slippage, Volatile markets = higher slippage
   */
  private getRegimeMultiplier(context: SlippageContext): number {
    const trendRegime = detectTrendRegime(context.candles, context.indicators);
    const volRegime = detectVolatilityRegime(context.candles, context.indicators);

    // Ranging markets: Lower slippage (more predictable prices)
    if (trendRegime === 'ranging' && volRegime === 'low') {
      return 0.8;
    }

    // Volatile markets: Higher slippage (prices move quickly)
    if (volRegime === 'high' || trendRegime === 'choppy') {
      return 1.3;
    }

    // Trending markets: Normal slippage
    return 1.0;
  }

  /**
   * Get recommended slippage for a trade
   * This is the main method to use
   */
  getRecommendedSlippage(
    candles: Candle[],
    indicators: Indicators,
    tradeSize: number,
    baseSlippageBps?: number
  ): number {
    return this.calculateSlippage({
      candles,
      indicators,
      tradeSize,
      baseSlippageBps,
      timeOfDay: new Date().getUTCHours(),
    });
  }
}

export const slippageManager = new SlippageManager();

