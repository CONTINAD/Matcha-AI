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
   * Get historical candles from 0x API
   */
  async getHistoricalCandles(options: DataFeedOptions & { baseAsset?: string }): Promise<Candle[]> {
    logger.info({ options }, 'Fetching historical candles from 0x');

    try {
      const candles = await dataAggregator.getHistoricalCandles({
        symbol: options.symbol,
        timeframe: options.timeframe,
        from: options.from,
        to: options.to,
        chainId: options.chainId,
        useCache: options.useCache,
        baseAsset: options.baseAsset || 'USDC',
      });
      if (candles.length > 0) {
        return candles;
      }
      logger.warn({ options }, 'No candles returned from 0x');
      return [];
    } catch (error) {
      logger.error({ error }, 'Historical candle fetch failed');
      throw error; // Don't use synthetic fallback - fail fast
    }
  }

  /**
   * Get latest enriched snapshot from 0x API
   */
  async getLatestMarketSnapshot(
    symbol: string, 
    timeframe: string, 
    chainId?: number,
    baseAsset: string = 'USDC'
  ): Promise<MarketSnapshot | null> {
    try {
      logger.debug({ symbol, timeframe, chainId, baseAsset }, 'DataFeed.getLatestMarketSnapshot called');
      const snapshot = await dataAggregator.getLatestSnapshot(symbol, timeframe, chainId, baseAsset);
      
      if (snapshot && snapshot.candle) {
        logger.info({ 
          symbol, 
          chainId, 
          baseAsset, 
          price: snapshot.candle.close,
          source: snapshot.source,
          hasCandle: true
        }, '✅ DataFeed: Successfully got market snapshot');
      } else {
        logger.warn({ symbol, chainId, baseAsset, snapshot: snapshot ? 'snapshot exists but no candle' : 'no snapshot' }, '⚠️ DataFeed: No candle in snapshot');
      }
      
      return snapshot;
    } catch (error: any) {
      logger.error({ 
        error: error.message, 
        symbol, 
        chainId,
        baseAsset,
        stack: error.stack 
      }, '❌ DataFeed: Live snapshot retrieval failed');
      return null;
    }
  }

  /**
   * Get latest candle only (for paper/live trading)
   */
  async getLatestCandle(
    symbol: string, 
    timeframe: string, 
    chainId?: number,
    baseAsset: string = 'USDC'
  ): Promise<Candle | null> {
    const snapshot = await this.getLatestMarketSnapshot(symbol, timeframe, chainId, baseAsset);
    return snapshot?.candle || null;
  }
}

export const dataFeed = new DataFeed();
