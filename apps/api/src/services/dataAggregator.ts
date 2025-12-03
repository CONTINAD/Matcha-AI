import type { Candle } from '@matcha-ai/shared';
import { timeframeToMs, getTokenConfig } from '@matcha-ai/shared';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { cacheClient } from './cache';
import { priceService } from './priceService';
import { dataProviderErrors, dataProviderLatency } from './metrics';

export interface MarketSnapshot {
  candle: Candle;
  source: '0x';
  vwap?: number;
  dexVolumeUsd24h?: number;
}

class DataAggregator {

  /**
   * Get historical candles from 0x API
   */
  async getHistoricalCandles(params: {
    symbol: string;
    timeframe: string;
    from: number;
    to: number;
    chainId?: number;
    useCache?: boolean;
    baseAsset?: string; // Base asset for price pairs (e.g., 'USDC', 'WETH')
  }): Promise<Candle[]> {
    const { symbol, timeframe, from, to, chainId = 1, useCache = true, baseAsset = 'USDC' } = params;
    const cacheKey = `hist:0x:${chainId}:${symbol}:${timeframe}:${from}:${to}`;

    if (useCache) {
      const cached = await cacheClient.get<Candle[]>(cacheKey);
      if (cached && cached.length > 0) {
        return cached;
      }
    }

    const endTimer = dataProviderLatency.startTimer({ provider: '0x', type: 'historical' });
    try {
      // Calculate interval based on timeframe
      const timeframeMs = timeframeToMs(timeframe);
      const interval = Math.max(3600, Math.floor(timeframeMs / 1000)); // At least 1 hour, or timeframe in seconds

      const candles = await priceService.getHistoricalPrices(
        chainId,
        baseAsset,
        symbol,
        from,
        to,
        interval
      );

      // If we got candles, bucket them by the actual timeframe
      if (candles.length > 0) {
        const bucketed = this.bucketCandlesByTimeframe(candles, timeframeMs);
        const validated = this.validateCandles(bucketed);

        if (useCache && validated.length > 0) {
          await cacheClient.set(cacheKey, validated, 300); // 5 minutes
        }

        return validated;
      }

      return [];
    } catch (error) {
      dataProviderErrors.inc({ provider: '0x', type: 'historical' });
      logger.error({ error, symbol, chainId }, 'Failed to fetch 0x historical candles');
      throw error;
    } finally {
      endTimer();
    }
  }

  /**
   * Get latest market snapshot from 0x API
   */
  async getLatestSnapshot(
    symbol: string,
    timeframe: string,
    chainId?: number,
    baseAsset: string = 'USDC'
  ): Promise<MarketSnapshot | null> {
    const endTimer = dataProviderLatency.startTimer({ provider: '0x', type: 'spot' });
    try {
      const actualChainId = chainId || 1;
      const snapshot = await priceService.getLatestSnapshot(actualChainId, baseAsset, symbol);
      
      if (!snapshot) {
        return null;
      }

      const candle: Candle = {
        open: snapshot.price,
        high: snapshot.price,
        low: snapshot.price,
        close: snapshot.price,
        volume: snapshot.volume24h || 0,
        timestamp: Date.now(),
      };

      return {
        candle,
        source: '0x',
        dexVolumeUsd24h: snapshot.volume24h,
      };
    } catch (error) {
      dataProviderErrors.inc({ provider: '0x', type: 'spot' });
      logger.error({ error, symbol, chainId }, 'Failed to fetch 0x latest snapshot');
      return null;
    } finally {
      endTimer();
    }
  }

  /**
   * Bucket candles by timeframe
   */
  private bucketCandlesByTimeframe(candles: Candle[], timeframeMs: number): Candle[] {
    if (candles.length === 0) return [];

    const buckets: Map<number, Candle> = new Map();
    
    for (const candle of candles) {
      const bucket = Math.floor(candle.timestamp / timeframeMs) * timeframeMs;
      const existing = buckets.get(bucket);
      
      if (!existing) {
        buckets.set(bucket, { ...candle, timestamp: bucket });
      } else {
        existing.high = Math.max(existing.high, candle.high);
        existing.low = Math.min(existing.low, candle.low);
        existing.close = candle.close;
        existing.volume += candle.volume;
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Validate and de-noise candle series
   */
  private validateCandles(candles: Candle[]): Candle[] {
    const filtered = candles.filter(
      (c) =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.volume) &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0
    );

    filtered.sort((a, b) => a.timestamp - b.timestamp);

    // Remove obvious outliers (price jump > 50% within one candle)
    const cleaned: Candle[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const candle = filtered[i];
      const prev = cleaned[cleaned.length - 1];
      if (prev) {
        const jump = Math.abs(candle.close - prev.close) / prev.close;
        if (jump > 0.5) {
          continue;
        }
      }
      cleaned.push(candle);
    }

    return cleaned;
  }

}

export const dataAggregator = new DataAggregator();
