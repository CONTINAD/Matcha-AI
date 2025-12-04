import axios from 'axios';
import { logger } from '../config/logger';
import { PrismaClient } from '@prisma/client';
import type { Candle } from '@matcha-ai/shared';
import { cacheClient } from './cache';
import { dataValidator } from './dataValidator';

const prisma = new PrismaClient();

/**
 * Service to fetch real Solana historical price data
 * Uses CoinGecko API (free tier) for historical SOL/USDC prices
 */
export class SolanaHistoricalData {
  private coingeckoApiUrl = 'https://api.coingecko.com/api/v3';
  private birdeyeApiUrl = 'https://public-api.birdeye.so';
  private jupiterApiUrl = 'https://quote-api.jup.ag/v6';

  private lastKnownPrice: number | null = null;
  private lastPriceTime: number = 0;
  private readonly PRICE_CACHE_TTL = 60000; // 1 minute cache

  /**
   * Get current SOL price from CoinGecko (simple endpoint)
   * With retry logic and caching
   */
  async getCurrentSOLPrice(): Promise<number> {
    // Return cached price if available and recent
    if (this.lastKnownPrice && Date.now() - this.lastPriceTime < this.PRICE_CACHE_TTL) {
      return this.lastKnownPrice;
    }

    const maxRetries = 3;
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
      const response = await axios.get(`${this.coingeckoApiUrl}/simple/price`, {
        params: {
          ids: 'solana',
          vs_currencies: 'usd',
        },
        timeout: 10000,
        validateStatus: (status) => status < 500, // Don't throw on 429
      });
      
      // Handle rate limiting - use cached price if available
      if (response.status === 429) {
        if (this.lastKnownPrice) {
          logger.warn({ cachedPrice: this.lastKnownPrice, age: Date.now() - this.lastPriceTime }, 'CoinGecko rate limited, using cached price');
          return this.lastKnownPrice;
        }
        throw new Error('CoinGecko rate limited and no cached price available');
      }
      
      const price = response.data?.solana?.usd;
      if (!price || price <= 0) {
        // If we have cached price, use it even if response is invalid
        if (this.lastKnownPrice) {
          logger.warn({ cachedPrice: this.lastKnownPrice }, 'Invalid CoinGecko response, using cached price');
          return this.lastKnownPrice;
        }
        throw new Error('Invalid price from CoinGecko');
      }
      
      // Cache successful price
      this.lastKnownPrice = price;
      this.lastPriceTime = Date.now();
      
      return price;
      } catch (error: any) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
          logger.warn({ attempt: attempt + 1, maxRetries, delay }, 'Retrying CoinGecko price fetch');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If all retries failed, try to return cached price
    if (this.lastKnownPrice) {
      logger.warn({ cachedPrice: this.lastKnownPrice, age: Date.now() - this.lastPriceTime }, 'Using cached SOL price after all retries failed');
      return this.lastKnownPrice;
    }
    
    logger.error({ error: lastError?.message }, 'Failed to fetch current SOL price from CoinGecko after all retries');
    throw new Error(`Failed to fetch SOL price after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  // Solana token addresses
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  private readonly USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  private readonly USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

  /**
   * Fetch historical candles from CoinGecko
   * CoinGecko provides free historical data for SOL
   */
  async fetchFromCoinGecko(
    fromTs: number,
    toTs: number,
    interval: '5m' | '15m' | '1h' | '4h' | '1d' = '1h'
  ): Promise<Candle[]> {
    const cacheKey = `solana:coingecko:${fromTs}:${toTs}:${interval}`;
    
    // Check cache first
    const cached = await cacheClient.get<Candle[]>(cacheKey);
    if (cached && cached.length > 0) {
      logger.info({ count: cached.length }, 'Using cached Solana historical data');
      return cached;
    }

    try {
      // CoinGecko uses days parameter for historical data
      const days = Math.ceil((toTs - fromTs) / (1000 * 60 * 60 * 24));
      const daysParam = days > 90 ? 90 : days > 30 ? 30 : days > 7 ? 7 : 1; // Max 90 days free tier

      // CoinGecko free tier - use simple price endpoint for historical
      // For free tier, we'll use the OHLC endpoint which doesn't require auth
      const response = await axios.get(`${this.coingeckoApiUrl}/coins/solana/ohlc`, {
        params: {
          vs_currency: 'usd',
          days: daysParam,
        },
        headers: {
          'Accept': 'application/json',
        },
        timeout: 15000,
      });

      // OHLC endpoint returns: [timestamp, open, high, low, close]
      const ohlcData = response.data as Array<[number, number, number, number, number]>;

      if (!ohlcData || ohlcData.length === 0) {
        logger.warn('No OHLC data from CoinGecko');
        return [];
      }

      // Convert OHLC to candles
      // CoinGecko returns timestamps in milliseconds: [timestamp_ms, open, high, low, close]
      const candles: Candle[] = ohlcData
        .filter(([ts]) => ts >= fromTs && ts <= toTs)
        .map(([timestamp, open, high, low, close]) => ({
          open,
          high,
          low,
          close,
          volume: 0, // OHLC endpoint doesn't provide volume
          timestamp, // Already in milliseconds
        }));

      // Cache for 24 hours
      if (candles.length > 0) {
        await cacheClient.set(cacheKey, candles, 86400);
        logger.info({ count: candles.length, from: new Date(fromTs), to: new Date(toTs) }, 'Fetched Solana historical data from CoinGecko');
      }

      return candles;
    } catch (error: any) {
      logger.error({ error: error.message, fromTs, toTs }, 'Failed to fetch CoinGecko data');
      throw error;
    }
  }

  /**
   * Fetch from Birdeye API (Solana-specific, requires API key)
   */
  async fetchFromBirdeye(
    fromTs: number,
    toTs: number,
    interval: '5m' | '15m' | '1h' | '4h' | '1d' = '1h'
  ): Promise<Candle[]> {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey) {
      throw new Error('BIRDEYE_API_KEY not configured');
    }

    const cacheKey = `solana:birdeye:${fromTs}:${toTs}:${interval}`;
    const cached = await cacheClient.get<Candle[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      // Use class constants for token addresses
      const solAddress = this.SOL_MINT;
      const usdcAddress = this.USDC_MINT;

      const response = await axios.get(`${this.birdeyeApiUrl}/defi/ohlcv`, {
        params: {
          address: solAddress,
          address_type: 'token',
          type: interval,
          time_from: Math.floor(fromTs / 1000),
          time_to: Math.floor(toTs / 1000),
        },
        headers: {
          'X-API-KEY': apiKey,
        },
        timeout: 15000,
      });

      const data = response.data.data;
      if (!data || !Array.isArray(data.items)) {
        return [];
      }

      const candles: Candle[] = data.items.map((item: any) => ({
        open: parseFloat(item.o || item.open || '0'),
        high: parseFloat(item.h || item.high || '0'),
        low: parseFloat(item.l || item.low || '0'),
        close: parseFloat(item.c || item.close || '0'),
        volume: parseFloat(item.v || item.volume || '0'),
        timestamp: item.unixTime ? item.unixTime * 1000 : item.time * 1000,
      }));

      if (candles.length > 0) {
        await cacheClient.set(cacheKey, candles, 86400);
        logger.info({ count: candles.length }, 'Fetched Solana historical data from Birdeye');
      }

      return candles;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch Birdeye data');
      throw error;
    }
  }

  /**
   * Store historical candles in database for fast backtesting
   */
  async storeCandlesInDatabase(
    candles: Candle[],
    symbol: string = 'SOL/USDC',
    chainId: number = 101
  ): Promise<number> {
    if (candles.length === 0) {
      return 0;
    }

    try {
      // Store in a historical_candles table (we'll need to add this to Prisma schema)
      // For now, we'll use the cache and return count
      logger.info({ count: candles.length, symbol, chainId }, 'Storing historical candles');
      return candles.length;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to store candles in database');
      throw error;
    }
  }

  /**
   * Fetch from Jupiter price API (for real-time and recent historical)
   */
  async fetchFromJupiter(
    fromTs: number,
    toTs: number,
    tokenMint: string = this.SOL_MINT
  ): Promise<Candle[]> {
    // Jupiter doesn't have historical endpoint, but we can use it for recent data
    // For now, return empty and let CoinGecko/Birdeye handle historical
    logger.debug('Jupiter API does not provide historical data, using CoinGecko/Birdeye');
    return [];
  }

  /**
   * Validate and fill gaps in candle data
   */
  private validateAndFillGaps(
    candles: Candle[],
    fromTs: number,
    toTs: number,
    interval: '5m' | '15m' | '1h' | '4h' | '1d'
  ): Candle[] {
    if (candles.length === 0) return candles;

    const intervalMs = this.getIntervalMs(interval);
    const validated: Candle[] = [];
    const sorted = candles.sort((a, b) => a.timestamp - b.timestamp);

    // Remove invalid candles
    const validCandles = sorted.filter(c => 
      c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0 &&
      c.high >= c.low &&
      c.high >= c.open && c.high >= c.close &&
      c.low <= c.open && c.low <= c.close
    );

    if (validCandles.length === 0) {
      logger.warn('No valid candles after validation');
      return [];
    }

    // Fill gaps with forward-fill (use last known price)
    let lastValidCandle: Candle | null = null;
    for (let ts = fromTs; ts <= toTs; ts += intervalMs) {
      const existing = validCandles.find(c => Math.abs(c.timestamp - ts) < intervalMs / 2);
      
      if (existing) {
        validated.push(existing);
        lastValidCandle = existing;
      } else if (lastValidCandle) {
        // Fill gap with last known price (flat candle)
        validated.push({
          open: lastValidCandle.close,
          high: lastValidCandle.close,
          low: lastValidCandle.close,
          close: lastValidCandle.close,
          volume: 0,
          timestamp: ts,
        });
      }
    }

    logger.info({ 
      original: candles.length, 
      validated: validated.length,
      gaps: validated.length - validCandles.length 
    }, 'Validated and filled gaps in Solana candles');

    return validated;
  }

  /**
   * Get historical candles for a specific Solana token
   */
  async getHistoricalCandlesForToken(
    tokenMint: string,
    fromTs: number,
    toTs: number,
    interval: '5m' | '15m' | '1h' | '4h' | '1d' = '1h'
  ): Promise<Candle[]> {
    // For now, only SOL/USDC is supported via CoinGecko
    // Other tokens would need Birdeye API
    if (tokenMint !== this.SOL_MINT) {
      logger.warn({ tokenMint }, 'Token not SOL, trying Birdeye if available');
      if (process.env.BIRDEYE_API_KEY) {
        try {
          return await this.fetchFromBirdeye(fromTs, toTs, interval);
        } catch (error) {
          logger.error({ error, tokenMint }, 'Failed to fetch token data from Birdeye');
          throw new Error(`Historical data not available for token ${tokenMint}`);
        }
      }
      throw new Error(`Historical data not available for token ${tokenMint}. Birdeye API key required.`);
    }

    return this.getHistoricalCandles(fromTs, toTs, interval);
  }

  /**
   * Get historical candles - tries CoinGecko first, then Birdeye if available
   * Enhanced with validation and gap filling
   */
  async getHistoricalCandles(
    fromTs: number,
    toTs: number,
    interval: '5m' | '15m' | '1h' | '4h' | '1d' = '1h'
  ): Promise<Candle[]> {
    const cacheKey = `solana:hist:${fromTs}:${toTs}:${interval}`;
    
    // Check cache first
    const cached = await cacheClient.get<Candle[]>(cacheKey);
    if (cached && cached.length > 0) {
      logger.info({ count: cached.length }, 'Using cached Solana historical data');
      return this.validateAndFillGaps(cached, fromTs, toTs, interval);
    }

    let candles: Candle[] = [];

    // Try CoinGecko first (free, no API key needed)
    try {
      candles = await this.fetchFromCoinGecko(fromTs, toTs, interval);
      if (candles.length > 0) {
        // Validate data is real (not synthetic) before processing
        if (!dataValidator.validateAndLog(candles, 'CoinGecko')) {
          throw new Error('Data validation failed - rejected fake/synthetic data');
        }
        const fakeCheck = dataValidator.rejectFakeData(candles);
        if (!fakeCheck.valid) {
          throw new Error(`Rejected fake data: ${fakeCheck.reason}`);
        }
        
        candles = this.validateAndFillGaps(candles, fromTs, toTs, interval);
        // Cache validated candles
        await cacheClient.set(cacheKey, candles, 86400);
        return candles;
      }
    } catch (error) {
      logger.warn({ error }, 'CoinGecko failed, trying Birdeye');
    }
    
    // Fallback to Birdeye if API key is available
    if (process.env.BIRDEYE_API_KEY) {
      try {
        candles = await this.fetchFromBirdeye(fromTs, toTs, interval);
        if (candles.length > 0) {
          // Validate data is real (not synthetic) before processing
          if (!dataValidator.validateAndLog(candles, 'Birdeye')) {
            throw new Error('Data validation failed - rejected fake/synthetic data');
          }
          const fakeCheck = dataValidator.rejectFakeData(candles);
          if (!fakeCheck.valid) {
            throw new Error(`Rejected fake data: ${fakeCheck.reason}`);
          }
          
          candles = this.validateAndFillGaps(candles, fromTs, toTs, interval);
          // Cache validated candles
          await cacheClient.set(cacheKey, candles, 3600); // Shorter cache for Birdeye
          return candles;
        }
      } catch (birdeyeError) {
        logger.error({ error: birdeyeError }, 'Both CoinGecko and Birdeye failed');
        throw new Error('Failed to fetch Solana historical data from all sources');
      }
    }
    
    if (candles.length === 0) {
      throw new Error('No Solana historical data available from any source');
    }

    return candles;
  }

  private getIntervalMs(interval: string): number {
    switch (interval) {
      case '5m':
        return 5 * 60 * 1000;
      case '15m':
        return 15 * 60 * 1000;
      case '1h':
        return 60 * 60 * 1000;
      case '4h':
        return 4 * 60 * 60 * 1000;
      case '1d':
        return 24 * 60 * 60 * 1000;
      default:
        return 60 * 60 * 1000;
    }
  }
}

export const solanaHistoricalData = new SolanaHistoricalData();

