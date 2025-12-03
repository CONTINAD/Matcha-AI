import type { Candle } from '@matcha-ai/shared';
import { extractIndicatorsSync } from './features';
import { logger } from '../config/logger';

export interface MultiTimeframeContext {
  primary: {
    timeframe: string;
    indicators: ReturnType<typeof extractIndicatorsSync>;
    trend: 'up' | 'down' | 'sideways';
  };
  higher: {
    timeframe: string;
    indicators: ReturnType<typeof extractIndicatorsSync>;
    trend: 'up' | 'down' | 'sideways';
  };
  lower: {
    timeframe: string;
    indicators: ReturnType<typeof extractIndicatorsSync>;
    trend: 'up' | 'down' | 'sideways';
  };
}

export class MultiTimeframeAnalysis {
  /**
   * Analyze multiple timeframes for better decision making
   */
  analyzeTimeframes(
    primaryCandles: Candle[],
    higherCandles: Candle[],
    lowerCandles: Candle[],
    primaryTimeframe: string
  ): MultiTimeframeContext {
    const primaryIndicators = extractIndicatorsSync(primaryCandles);
    const higherIndicators = extractIndicatorsSync(higherCandles);
    const lowerIndicators = extractIndicatorsSync(lowerCandles);

    // Determine trends
    const primaryTrend = this.determineTrend(primaryIndicators);
    const higherTrend = this.determineTrend(higherIndicators);
    const lowerTrend = this.determineTrend(lowerIndicators);

    return {
      primary: {
        timeframe: primaryTimeframe,
        indicators: primaryIndicators,
        trend: primaryTrend,
      },
      higher: {
        timeframe: this.getHigherTimeframe(primaryTimeframe),
        indicators: higherIndicators,
        trend: higherTrend,
      },
      lower: {
        timeframe: this.getLowerTimeframe(primaryTimeframe),
        indicators: lowerIndicators,
        trend: lowerTrend,
      },
    };
  }

  /**
   * Determine trend from indicators
   */
  private determineTrend(indicators: ReturnType<typeof extractIndicatorsSync>): 'up' | 'down' | 'sideways' {
    const emaTrend = indicators.emaTrend || 0;
    const macd = indicators.macd || 0;
    const rsi = indicators.rsi || 50;

    // Strong uptrend signals
    if (emaTrend > 0 && macd > 0 && rsi > 50) {
      return 'up';
    }

    // Strong downtrend signals
    if (emaTrend < 0 && macd < 0 && rsi < 50) {
      return 'down';
    }

    return 'sideways';
  }

  /**
   * Get higher timeframe (e.g., 1h -> 4h)
   */
  private getHigherTimeframe(timeframe: string): string {
    const multipliers: Record<string, string> = {
      '1m': '5m',
      '5m': '15m',
      '15m': '1h',
      '1h': '4h',
      '4h': '1d',
      '1d': '1w',
    };
    return multipliers[timeframe] || timeframe;
  }

  /**
   * Get lower timeframe (e.g., 1h -> 15m)
   */
  private getLowerTimeframe(timeframe: string): string {
    const multipliers: Record<string, string> = {
      '5m': '1m',
      '15m': '5m',
      '1h': '15m',
      '4h': '1h',
      '1d': '4h',
      '1w': '1d',
    };
    return multipliers[timeframe] || timeframe;
  }

  /**
   * Get trading bias from multi-timeframe analysis
   */
  getTradingBias(context: MultiTimeframeContext): {
    bias: 'bullish' | 'bearish' | 'neutral';
    strength: number; // 0-1
    reasoning: string;
  } {
    const trends = [context.higher.trend, context.primary.trend, context.lower.trend];
    const bullishCount = trends.filter((t) => t === 'up').length;
    const bearishCount = trends.filter((t) => t === 'down').length;

    let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let strength = 0.5;
    let reasoning = '';

    if (bullishCount >= 2) {
      bias = 'bullish';
      strength = bullishCount / 3;
      reasoning = `${bullishCount}/3 timeframes showing uptrend`;
    } else if (bearishCount >= 2) {
      bias = 'bearish';
      strength = bearishCount / 3;
      reasoning = `${bearishCount}/3 timeframes showing downtrend`;
    } else {
      reasoning = 'Mixed signals across timeframes';
    }

    // Check for alignment
    if (context.higher.trend === context.primary.trend && context.primary.trend === context.lower.trend) {
      strength = 1.0;
      reasoning += ' - All timeframes aligned';
    }

    return { bias, strength, reasoning };
  }
}

export const multiTimeframeAnalysis = new MultiTimeframeAnalysis();

