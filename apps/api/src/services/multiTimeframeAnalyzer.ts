import { dataFeed } from './dataFeed';
import { extractIndicators } from './features';
import type { Candle, MarketContext } from '@matcha-ai/shared';
import { logger } from '../config/logger';

export interface MultiTimeframeAnalysis {
  primary: {
    timeframe: string;
    trend: 'bullish' | 'bearish' | 'neutral';
    strength: number; // 0-1
    indicators: any;
  };
  higher: {
    timeframe: string;
    trend: 'bullish' | 'bearish' | 'neutral';
    strength: number;
    indicators: any;
  };
  lower: {
    timeframe: string;
    trend: 'bullish' | 'bearish' | 'neutral';
    strength: number;
    indicators: any;
  };
  alignment: 'aligned' | 'mixed' | 'conflicting';
  confidence: number; // 0-1
}

/**
 * Multi-Timeframe Analyzer
 * Analyzes market across multiple timeframes for better decisions
 */
export class MultiTimeframeAnalyzer {
  /**
   * Analyze market across multiple timeframes
   */
  async analyze(
    symbol: string,
    primaryTimeframe: string,
    chainId: number
  ): Promise<MultiTimeframeAnalysis> {
    // Get higher timeframe (e.g., if primary is 1h, higher is 4h)
    const higherTimeframe = this.getHigherTimeframe(primaryTimeframe);
    const lowerTimeframe = this.getLowerTimeframe(primaryTimeframe);

    // Fetch candles for all timeframes
    const [primaryCandles, higherCandles, lowerCandles] = await Promise.all([
      this.getCandles(symbol, primaryTimeframe, chainId),
      this.getCandles(symbol, higherTimeframe, chainId),
      this.getCandles(symbol, lowerTimeframe, chainId),
    ]);

    // Analyze each timeframe
    const primary = this.analyzeTimeframe(primaryCandles, primaryTimeframe);
    const higher = this.analyzeTimeframe(higherCandles, higherTimeframe);
    const lower = this.analyzeTimeframe(lowerCandles, lowerTimeframe);

    // Determine alignment
    const alignment = this.determineAlignment(primary.trend, higher.trend, lower.trend);
    
    // Calculate confidence based on alignment
    const confidence = this.calculateConfidence(primary, higher, lower, alignment);

    return {
      primary,
      higher,
      lower,
      alignment,
      confidence,
    };
  }

  /**
   * Get candles for a timeframe
   */
  private async getCandles(
    symbol: string,
    timeframe: string,
    chainId: number,
    limit: number = 100
  ): Promise<Candle[]> {
    try {
      // Get historical candles
      const candles: Candle[] = [];
      const now = Date.now();
      const timeframeMs = this.parseTimeframeToMs(timeframe);
      const startTime = now - (timeframeMs * limit);

      // Fetch candles from data feed
      for (let i = 0; i < limit; i++) {
        const timestamp = startTime + (i * timeframeMs);
        const snapshot = await dataFeed.getLatestMarketSnapshot(symbol, timeframe, chainId);
        if (snapshot?.candle) {
          candles.push(snapshot.candle);
        }
      }

      return candles;
    } catch (error) {
      logger.error({ error, symbol, timeframe }, 'Error fetching candles');
      return [];
    }
  }

  /**
   * Analyze a single timeframe
   */
  private analyzeTimeframe(candles: Candle[], timeframe: string): {
    timeframe: string;
    trend: 'bullish' | 'bearish' | 'neutral';
    strength: number;
    indicators: any;
  } {
    if (candles.length < 20) {
      return {
        timeframe,
        trend: 'neutral',
        strength: 0,
        indicators: {},
      };
    }

    const indicators = extractIndicators(candles);
    const trend = this.determineTrend(indicators, candles);
    const strength = this.calculateTrendStrength(indicators, candles);

    return {
      timeframe,
      trend,
      strength,
      indicators,
    };
  }

  /**
   * Determine trend direction
   */
  private determineTrend(indicators: any, candles: Candle[]): 'bullish' | 'bearish' | 'neutral' {
    const emaFast = indicators.emaFast || 0;
    const emaSlow = indicators.emaSlow || 0;
    const rsi = indicators.rsi || 50;
    const macd = indicators.macd || 0;

    let bullish = 0;
    let bearish = 0;

    // EMA crossover
    if (emaFast > emaSlow) bullish++;
    else bearish++;

    // RSI
    if (rsi > 50) bullish++;
    else bearish++;

    // MACD
    if (macd > 0) bullish++;
    else bearish++;

    // Price momentum
    if (candles.length >= 2) {
      const priceChange = (candles[candles.length - 1].close - candles[0].close) / candles[0].close;
      if (priceChange > 0.01) bullish++;
      else if (priceChange < -0.01) bearish++;
    }

    if (bullish > bearish + 1) return 'bullish';
    if (bearish > bullish + 1) return 'bearish';
    return 'neutral';
  }

  /**
   * Calculate trend strength
   */
  private calculateTrendStrength(indicators: any, candles: Candle[]): number {
    const emaDiff = Math.abs((indicators.emaFast || 0) - (indicators.emaSlow || 0));
    const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
    const strength = Math.min(emaDiff / avgPrice * 100, 1); // Normalize to 0-1
    return strength;
  }

  /**
   * Determine alignment across timeframes
   */
  private determineAlignment(
    primary: 'bullish' | 'bearish' | 'neutral',
    higher: 'bullish' | 'bearish' | 'neutral',
    lower: 'bullish' | 'bearish' | 'neutral'
  ): 'aligned' | 'mixed' | 'conflicting' {
    if (primary === higher && higher === lower) {
      return 'aligned';
    }
    if (primary !== higher && primary !== lower && higher !== lower) {
      return 'conflicting';
    }
    return 'mixed';
  }

  /**
   * Calculate confidence based on alignment
   */
  private calculateConfidence(
    primary: { strength: number },
    higher: { strength: number },
    lower: { strength: number },
    alignment: string
  ): number {
    let confidence = (primary.strength + higher.strength + lower.strength) / 3;

    // Boost confidence if aligned
    if (alignment === 'aligned') {
      confidence *= 1.3;
    } else if (alignment === 'conflicting') {
      confidence *= 0.7;
    }

    return Math.min(confidence, 1);
  }

  /**
   * Get higher timeframe
   */
  private getHigherTimeframe(timeframe: string): string {
    const match = timeframe.match(/^(\d+)([mhd])$/);
    if (!match) return '4h';

    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (unit === 'm') {
      if (value <= 5) return '15m';
      if (value <= 15) return '1h';
      if (value <= 60) return '4h';
      return '1d';
    } else if (unit === 'h') {
      if (value <= 1) return '4h';
      if (value <= 4) return '1d';
      return '1w';
    }
    return '1w';
  }

  /**
   * Get lower timeframe
   */
  private getLowerTimeframe(timeframe: string): string {
    const match = timeframe.match(/^(\d+)([mhd])$/);
    if (!match) return '5m';

    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (unit === 'h') {
      if (value >= 4) return '1h';
      if (value >= 1) return '15m';
      return '5m';
    } else if (unit === 'd') {
      return '4h';
    }
    return '1m';
  }

  /**
   * Parse timeframe to milliseconds
   */
  private parseTimeframeToMs(timeframe: string): number {
    const match = timeframe.match(/^(\d+)([mhd])$/);
    if (!match) return 60 * 60 * 1000; // Default 1h

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit] || 60 * 60 * 1000;
  }
}

export const multiTimeframeAnalyzer = new MultiTimeframeAnalyzer();


