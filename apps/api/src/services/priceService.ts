import axios from 'axios';
import Redis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { getChainConfig, getTokenAddress } from '@matcha-ai/shared';
import type { Candle } from '@matcha-ai/shared';
import { cacheClient } from './cache';

const redis = config.dataProviders.cache.redisUrl 
  ? new Redis(config.dataProviders.cache.redisUrl)
  : null;

export class PriceService {
  /**
   * Get live price from 0x API
   * Uses /price endpoint for real-time quotes
   */
  async getLivePrice(
    chainId: number,
    sellToken: string,
    buyToken: string
  ): Promise<number> {
    const cacheKey = `price:${chainId}:${sellToken}:${buyToken}`;
    
    // Check cache first
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return parseFloat(cached);
      }
    } else {
      // Fallback to cacheClient if Redis not available
      const cached = await cacheClient.get<string>(cacheKey);
      if (cached) {
        return parseFloat(cached);
      }
    }

    try {
      const chainConfig = getChainConfig(chainId);
      if (!chainConfig?.zeroXApiUrl) {
        throw new Error(`Unsupported chain: ${chainId}`);
      }

      // Get token addresses
      const sellTokenAddr = getTokenAddress(sellToken, chainId) || sellToken;
      const buyTokenAddr = getTokenAddress(buyToken, chainId) || buyToken;

      const { data } = await axios.get(`${chainConfig.zeroXApiUrl}/swap/v2/price`, {
        params: {
          sellToken: sellTokenAddr,
          buyToken: buyTokenAddr,
          sellAmount: '1000000000000000000', // 1 token (18 decimals)
        },
        headers: {
          '0x-api-key': config.dataProviders.zeroX.apiKey,
          '0x-version': 'v2',
        },
        timeout: 5000,
      });

      const price = parseFloat(data.price);
      
      // Cache for 3 seconds
      if (redis) {
        await redis.set(cacheKey, price.toString(), 'EX', 3);
      } else {
        await cacheClient.set(cacheKey, price.toString(), 3);
      }

      return price;
    } catch (error) {
      logger.error({ error, chainId, sellToken, buyToken }, 'Failed to fetch 0x price');
      throw error;
    }
  }

  /**
   * Get historical prices using 0x historical trades
   * Aggregates trades into candles
   */
  async getHistoricalPrices(
    chainId: number,
    sellToken: string,
    buyToken: string,
    fromTs: number,
    toTs: number,
    interval: number = 3600 // 1 hour default
  ): Promise<Candle[]> {
    const candles: Candle[] = [];
    const chainConfig = getChainConfig(chainId);
    
    if (!chainConfig?.zeroXApiUrl) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    // Get token addresses
    const sellTokenAddr = getTokenAddress(sellToken, chainId) || sellToken;
    const buyTokenAddr = getTokenAddress(buyToken, chainId) || buyToken;

    // Check cache first
    const cacheKey = `hist:${chainId}:${sellToken}:${buyToken}:${fromTs}:${toTs}:${interval}`;
    const cached = await cacheClient.get<Candle[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    // Fetch historical trades in chunks
    for (let ts = fromTs; ts < toTs; ts += interval) {
      try {
        const { data } = await axios.get(`${chainConfig.zeroXApiUrl}/swap/v2/historicalTrades`, {
          params: {
            sellToken: sellTokenAddr,
            buyToken: buyTokenAddr,
            startTimestamp: Math.floor(ts / 1000), // 0x expects seconds
            endTimestamp: Math.floor((ts + interval) / 1000),
            limit: 1000,
          },
          headers: {
            '0x-api-key': config.zeroX.apiKey,
            '0x-version': 'v2',
          },
          timeout: 10000,
        });

        if (data.trades && data.trades.length > 0) {
          const prices = data.trades.map((t: any) => parseFloat(t.price || '0'));
          const volumes = data.trades.map((t: any) => parseFloat(t.sellAmount || '0'));
          
          if (prices.length > 0 && prices.every(p => p > 0)) {
            const open = prices[0];
            const close = prices[prices.length - 1];
            const high = Math.max(...prices);
            const low = Math.min(...prices);
            const volume = volumes.reduce((a: number, b: number) => a + b, 0);

            candles.push({
              open,
              high,
              low,
              close,
              volume,
              timestamp: ts,
            });
          }
        }
      } catch (error) {
        logger.warn({ error, ts }, 'Failed to fetch historical trades for period');
        // Continue with next period - don't fail entire request
      }
    }

    // Cache results for 1 hour
    if (candles.length > 0) {
      await cacheClient.set(cacheKey, candles, 3600);
    }

    return candles;
  }

  /**
   * Get latest market snapshot (price + volume)
   */
  async getLatestSnapshot(
    chainId: number,
    sellToken: string,
    buyToken: string
  ): Promise<{ price: number; volume24h?: number }> {
    const price = await this.getLivePrice(chainId, sellToken, buyToken);
    
    // Optionally fetch 24h volume from 0x
    let volume24h: number | undefined;
    try {
      const oneDayAgo = Date.now() - 86400000;
      const candles = await this.getHistoricalPrices(
        chainId,
        sellToken,
        buyToken,
        oneDayAgo,
        Date.now(),
        3600
      );
      volume24h = candles.reduce((sum, c) => sum + c.volume, 0);
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch 24h volume');
    }

    return { price, volume24h };
  }

  /**
   * Build candles from price data with proper timeframe bucketing
   */
  buildCandlesFromTrades(
    trades: Array<{ price: number; timestamp: number; volume: number }>,
    timeframeMs: number
  ): Candle[] {
    if (!trades || trades.length === 0) return [];

    const buckets: Map<number, Candle> = new Map();
    
    for (const trade of trades) {
      const bucket = Math.floor(trade.timestamp / timeframeMs) * timeframeMs;
      const existing = buckets.get(bucket);
      
      if (!existing) {
        buckets.set(bucket, {
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.volume,
          timestamp: bucket,
        });
      } else {
        existing.high = Math.max(existing.high, trade.price);
        existing.low = Math.min(existing.low, trade.price);
        existing.close = trade.price;
        existing.volume += trade.volume;
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
  }
}

export const priceService = new PriceService();

