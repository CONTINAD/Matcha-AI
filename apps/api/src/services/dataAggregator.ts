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
  // In-memory cache for recent price fetches (30 second TTL)
  private priceCache = new Map<string, { price: number; timestamp: number }>();
  private readonly PRICE_CACHE_TTL = 30000; // 30 seconds

  /**
   * Get cached price if available and recent
   */
  private getCachedPrice(cacheKey: string): number | null {
    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.PRICE_CACHE_TTL) {
      logger.debug({ cacheKey, price: cached.price, age: Date.now() - cached.timestamp }, 'Using cached price');
      return cached.price;
    }
    return null;
  }

  /**
   * Cache a price
   */
  private setCachedPrice(cacheKey: string, price: number): void {
    this.priceCache.set(cacheKey, { price, timestamp: Date.now() });
    // Clean up old entries periodically (keep cache size reasonable)
    if (this.priceCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of this.priceCache.entries()) {
        if (now - value.timestamp > this.PRICE_CACHE_TTL) {
          this.priceCache.delete(key);
        }
      }
    }
  }

  /**
   * Get historical candles from 0x API (EVM) or Solana data sources
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
    const cacheKey = `hist:${chainId === 101 ? 'solana' : '0x'}:${chainId}:${symbol}:${timeframe}:${from}:${to}`;

    if (useCache) {
      const cached = await cacheClient.get<Candle[]>(cacheKey);
      if (cached && cached.length > 0) {
        logger.info({ count: cached.length, chainId, symbol }, 'Using cached historical candles');
        return cached;
      }
    }

    const endTimer = dataProviderLatency.startTimer({ provider: chainId === 101 ? 'solana' : '0x', type: 'historical' });
    try {
      // Calculate interval based on timeframe
      const timeframeMs = timeframeToMs(timeframe);
      const interval = Math.max(3600, Math.floor(timeframeMs / 1000)); // At least 1 hour, or timeframe in seconds

      // For Solana, map symbol to SOL if needed
      const actualSymbol = chainId === 101 && (symbol === 'SOL' || symbol === 'USDC' || !symbol) ? 'SOL' : symbol;

      const candles = await priceService.getHistoricalPrices(
        chainId,
        baseAsset,
        actualSymbol,
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
    const actualChainId = chainId || 1;
    
    // Detailed logging for data feed debugging
    logger.info({ 
      symbol, 
      timeframe, 
      chainId: actualChainId, 
      baseAsset,
      requestType: 'getLatestSnapshot'
    }, '📡 Data feed request');
    
    // Solana uses Jupiter/CoinGecko, not 0x API
    if (actualChainId === 101) {
      const endTimer = dataProviderLatency.startTimer({ provider: 'solana', type: 'spot' });
      try {
        // Check cache first
        const cacheKey = `price:${actualChainId}:${symbol}:${baseAsset}`;
        const cachedPrice = this.getCachedPrice(cacheKey);
        if (cachedPrice !== null) {
          const candle: Candle = {
            open: cachedPrice,
            high: cachedPrice,
            low: cachedPrice,
            close: cachedPrice,
            volume: 0,
            timestamp: Date.now(),
          };
          return {
            candle,
            source: 'coingecko', // Assume cached from CoinGecko
            dexVolumeUsd24h: undefined,
          };
        }

        // For Solana, try Jupiter API first, then fallback to CoinGecko
        const { solanaService } = await import('./solanaService');
        const { getTokenAddress } = await import('@matcha-ai/shared');
        
        // Get token mints
        const inputMint = symbol === 'SOL' 
          ? 'So11111111111111111111111111111111111111112' // Wrapped SOL
          : getTokenAddress(symbol, 101) || symbol;
        const outputMint = baseAsset === 'USDC'
          ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC on Solana
          : getTokenAddress(baseAsset, 101) || baseAsset;
        
        let price: number;
        let source = 'coingecko';
        
        // Use CoinGecko for SOL price (most reliable)
        if (symbol === 'SOL' && baseAsset === 'USDC') {
          try {
            const { solanaHistoricalData } = await import('./solanaHistoricalData');
            price = await solanaHistoricalData.getCurrentSOLPrice();
            source = 'coingecko';
            logger.info({ symbol, price, source }, '✅ Fetched SOL price from CoinGecko');
          } catch (coingeckoError: any) {
            // Fallback: try Jupiter if CoinGecko fails
            logger.warn({ error: coingeckoError.message, symbol }, 'CoinGecko failed, trying Jupiter');
            try {
              const amount = 1000000000; // 1 SOL
              const quote = await solanaService.getJupiterQuote({
                inputMint,
                outputMint,
                amount,
                slippageBps: 50,
              });
              price = parseFloat(quote.outAmount) / parseFloat(quote.inAmount);
              source = 'jupiter';
            } catch (jupiterError: any) {
              // Try to use cached price as last resort
              const cachedPrice = this.getCachedPrice(cacheKey);
              if (cachedPrice !== null) {
                logger.warn({ cachedPrice }, 'Using cached price after all APIs failed');
                price = cachedPrice;
                source = 'cache';
              } else {
                throw new Error(`All price sources failed: CoinGecko (${coingeckoError.message}), Jupiter (${jupiterError.message})`);
              }
            }
          }
        } else {
          // For non-SOL tokens, try Jupiter first
          try {
            const amount = 1000000; // 1 token
            const quote = await solanaService.getJupiterQuote({
              inputMint,
              outputMint,
              amount,
              slippageBps: 50,
            });
            price = parseFloat(quote.outAmount) / parseFloat(quote.inAmount);
            source = 'jupiter';
          } catch (jupiterError: any) {
            // Try to use cached price as last resort
            const cachedPrice = this.getCachedPrice(cacheKey);
            if (cachedPrice !== null) {
              logger.warn({ cachedPrice }, 'Using cached price after Jupiter failed');
              price = cachedPrice;
              source = 'cache';
            } else {
              throw new Error(`Jupiter API failed for ${symbol}: ${jupiterError.message}`);
            }
          }
        }
        
        // Cache successful price fetch
        this.setCachedPrice(cacheKey, price);
        
        const candle: Candle = {
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0, // Price APIs don't provide real-time volume
          timestamp: Date.now(),
        };

        return {
          candle,
          source: source as 'jupiter' | 'coingecko',
          dexVolumeUsd24h: undefined,
        };
      } catch (error) {
        dataProviderErrors.inc({ provider: 'solana', type: 'spot' });
        logger.error({ error, symbol, chainId }, 'Failed to fetch Solana latest snapshot (all sources failed)');
        return null;
      } finally {
        endTimer();
      }
    }
    
    // EVM chains use 0x API
    const endTimer = dataProviderLatency.startTimer({ provider: '0x', type: 'spot' });
    try {
      // Get token addresses for logging
      const { getTokenAddress } = await import('@matcha-ai/shared');
      const sellTokenAddr = getTokenAddress(baseAsset, actualChainId);
      const buyTokenAddr = getTokenAddress(symbol, actualChainId);
      
      logger.info({ 
        symbol, 
        baseAsset, 
        chainId: actualChainId,
        sellTokenAddr,
        buyTokenAddr,
        pair: `${baseAsset}/${symbol}`
      }, '📡 Fetching price from 0x API');
      
      // Check cache first for EVM chains too
      const cacheKey = `price:${actualChainId}:${symbol}:${baseAsset}`;
      const cachedPrice = this.getCachedPrice(cacheKey);
      if (cachedPrice !== null) {
        logger.info({ symbol, baseAsset, chainId: actualChainId, price: cachedPrice, source: 'cache' }, '✅ Using cached price');
        const candle: Candle = {
          open: cachedPrice,
          high: cachedPrice,
          low: cachedPrice,
          close: cachedPrice,
          volume: 0,
          timestamp: Date.now(),
        };
        return {
          candle,
          source: '0x',
          dexVolumeUsd24h: undefined,
        };
      }

      // For price quotes: sell baseAsset to buy symbol (e.g., sell USDC to buy WETH)
      // This gives us the price of symbol in terms of baseAsset
      let snapshot: { price: number; volume24h?: number } | null = null;
      let snapshotError: any = null;
      
      try {
        snapshot = await priceService.getLatestSnapshot(actualChainId, baseAsset, symbol, false);
      } catch (error: any) {
        snapshotError = error;
        logger.warn({ 
          error: error.message, 
          symbol, 
          baseAsset, 
          chainId: actualChainId,
          reason: '0x API call failed, trying fallbacks'
        }, '⚠️ 0x API call failed');
      }
      
      if (!snapshot) {
        // Try cached price first
        const cachedPrice = this.getCachedPrice(cacheKey);
        if (cachedPrice !== null) {
          logger.info({ symbol, baseAsset, chainId: actualChainId, price: cachedPrice, source: 'cache_fallback' }, '✅ Using cached price after 0x API failed');
          const candle: Candle = {
            open: cachedPrice,
            high: cachedPrice,
            low: cachedPrice,
            close: cachedPrice,
            volume: 0,
            timestamp: Date.now(),
          };
          return {
            candle,
            source: '0x',
            dexVolumeUsd24h: undefined,
          };
        }
        
        // IMMEDIATE CoinGecko fallback for WETH/ETH (real market data, not synthetic)
        if (symbol.toUpperCase() === 'WETH' || symbol.toUpperCase() === 'ETH') {
          try {
            logger.info({ symbol, chainId: actualChainId, reason: '0x API failed, using CoinGecko immediately' }, '🔄 Trying CoinGecko as immediate fallback for WETH price');
            const coingeckoResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=weth&vs_currencies=usd', {
              signal: AbortSignal.timeout(5000), // 5 second timeout
            });
            if (!coingeckoResponse.ok) {
              throw new Error(`CoinGecko API returned ${coingeckoResponse.status}`);
            }
            const coingeckoData = await coingeckoResponse.json();
            const wethPrice = coingeckoData?.weth?.usd;
            if (wethPrice && wethPrice > 0) {
              logger.info({ symbol, price: wethPrice, source: 'coingecko', chainId: actualChainId }, '✅ Got WETH price from CoinGecko (immediate fallback)');
              this.setCachedPrice(cacheKey, wethPrice);
              const candle: Candle = {
                open: wethPrice,
                high: wethPrice * 1.01,
                low: wethPrice * 0.99,
                close: wethPrice,
                volume: 0,
                timestamp: Date.now(),
              };
              return {
                candle,
                source: 'coingecko',
                dexVolumeUsd24h: undefined,
              };
            } else {
              throw new Error('Invalid price from CoinGecko');
            }
          } catch (coingeckoError: any) {
            logger.warn({ error: coingeckoError.message, symbol, chainId: actualChainId }, 'CoinGecko fallback also failed');
          }
        }
        
        logger.error({ 
          symbol, 
          baseAsset, 
          chainId: actualChainId, 
          sellTokenAddr, 
          buyTokenAddr,
          snapshotError: snapshotError?.message,
          reason: 'All price sources failed (0x API, cache, CoinGecko)'
        }, '❌ No snapshot, no cached price, and CoinGecko fallback failed');
        return null;
      }

      // Cache successful price fetch
      this.setCachedPrice(cacheKey, snapshot.price);
      
      logger.info({ 
        symbol, 
        baseAsset, 
        chainId: actualChainId, 
        price: snapshot.price, 
        volume24h: snapshot.volume24h,
        source: '0x_api'
      }, '✅ Successfully fetched price from 0x API');

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
    } catch (error: any) {
      dataProviderErrors.inc({ provider: '0x', type: 'spot' });
      logger.error({ 
        error: error.message, 
        symbol, 
        chainId: actualChainId,
        baseAsset,
        stack: error.stack 
      }, '❌ Failed to fetch 0x latest snapshot');
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
