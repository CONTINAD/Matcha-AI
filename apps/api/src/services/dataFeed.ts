import type { Candle } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { dataAggregator, type MarketSnapshot } from './dataAggregator';

export interface DataFeedOptions {
  symbol: string;
  timeframe: string;
  from: number; // timestamp
  to: number; // timestamp
  chainId?: number;
  useCache?: boolean;
}

export class DataFeed {
  /**
   * Get historical candles
   * Primary source: CoinGecko Pro (with caching)
   * Fallback: synthetic data to keep the system running
   */
  async getHistoricalCandles(options: DataFeedOptions): Promise<Candle[]> {
    logger.info({ options }, 'Fetching historical candles (live data)');

    try {
      const candles = await dataAggregator.getHistoricalCandles({
        symbol: options.symbol,
        timeframe: options.timeframe,
        from: options.from,
        to: options.to,
        chainId: options.chainId,
        useCache: options.useCache,
      });
      if (candles.length > 0) {
        return candles;
      }
      logger.warn({ options }, 'No candles returned from provider, falling back to synthetic data');
      return this.generateSyntheticCandles(options);
    } catch (error) {
      logger.error({ error }, 'Historical candle fetch failed, using synthetic fallback');
      return this.generateSyntheticCandles(options);
    }
  }

  /**
   * Get latest enriched snapshot (candle + order book + DEX volume)
   */
  async getLatestMarketSnapshot(symbol: string, timeframe: string, chainId?: number): Promise<MarketSnapshot | null> {
    try {
      const snapshot = await dataAggregator.getLatestSnapshot(symbol, timeframe, chainId);
      if (snapshot) {
        return snapshot;
      }
    } catch (error) {
      logger.warn({ error, symbol }, 'Live snapshot retrieval failed, trying fallback');
    }

    // Fallback to synthetic
    const fallback = this.generateSyntheticCandles({
      symbol,
      timeframe,
      from: Date.now() - this.parseTimeframeToMs(timeframe),
      to: Date.now(),
    }).pop();

    if (!fallback) return null;

    return {
      candle: fallback,
      source: 'coingecko',
    };
  }

  /**
   * Get latest candle only (for paper/live trading)
   */
  async getLatestCandle(symbol: string, timeframe: string): Promise<Candle | null> {
    const snapshot = await this.getLatestMarketSnapshot(symbol, timeframe);
    return snapshot?.candle || null;
  }

  private generateSyntheticCandles(options: DataFeedOptions): Candle[] {
    const candles: Candle[] = [];
    const timeframeMs = this.parseTimeframeToMs(options.timeframe);
    const startTime = options.from;
    const endTime = options.to;

    let currentPrice = 100;
    let currentTime = startTime;

    while (currentTime < endTime) {
      const change = (Math.random() - 0.5) * 2;
      const volatility = 0.02;
      currentPrice = currentPrice * (1 + change * volatility);

      const open = currentPrice;
      const high = open * (1 + Math.random() * 0.01);
      const low = open * (1 - Math.random() * 0.01);
      const close = low + (high - low) * Math.random();
      const volume = Math.random() * 1000000;

      candles.push({
        open,
        high,
        low,
        close,
        volume,
        timestamp: currentTime,
      });

      currentTime += timeframeMs;
      currentPrice = close;
    }

    return candles;
  }

  private parseTimeframeToMs(timeframe: string): number {
    const match = timeframe.match(/^(\d+)([mhd])$/);
    if (!match) throw new Error(`Invalid timeframe: ${timeframe}`);
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * multipliers[unit];
  }
}

export const dataFeed = new DataFeed();
