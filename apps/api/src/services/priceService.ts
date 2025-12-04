import axios from 'axios';
import Redis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { getChainConfig, getTokenAddress, getTokenConfig } from '@matcha-ai/shared';
import type { Candle } from '@matcha-ai/shared';
import { cacheClient } from './cache';
import { solanaHistoricalData } from './solanaHistoricalData';
import { apiRateLimiter } from './apiRateLimiter';
import { dataValidator } from './dataValidator';

const redis = config.dataProviders.cache.redisUrl 
  ? new Redis(config.dataProviders.cache.redisUrl)
  : null;

export class PriceService {
  // In-memory cache for recent price fetches (30 second TTL)
  private priceCache = new Map<string, { price: number; timestamp: number }>();
  private readonly PRICE_CACHE_TTL = 30000; // 30 seconds

  /**
   * Get cached price from in-memory cache if available and recent
   */
  private getCachedPrice(cacheKey: string): number | null {
    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.PRICE_CACHE_TTL) {
      logger.debug({ cacheKey, price: cached.price, age: Date.now() - cached.timestamp }, 'Using in-memory cached price');
      return cached.price;
    }
    return null;
  }

  /**
   * Cache a price in memory
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
   * Check if an error is retryable (network errors, 5xx, 429, timeouts)
   */
  private isRetryableError(error: any): boolean {
    // Retry on network errors (no response)
    if (!error.response) return true;
    
    const status = error.response.status;
    // Retry on server errors (5xx), rate limits (429), and timeouts (408)
    return status >= 500 || status === 429 || status === 408;
  }

  /**
   * Convert symbol to 0x-compatible token address
   * Handles native ETH (uses special address) and other tokens
   */
  private resolveTokenAddress(symbol: string, chainId: number): string {
    // Native ETH uses special address for 0x API
    if (symbol.toUpperCase() === 'ETH' && chainId !== 101) {
      return '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    }
    
    // Try to get token address from config
    const tokenAddr = getTokenAddress(symbol, chainId);
    if (tokenAddr) {
      return tokenAddr;
    }
    
    // If symbol is already an address (starts with 0x), use it
    if (symbol.startsWith('0x')) {
      return symbol;
    }
    
    // Fallback: try WETH if ETH was requested
    if (symbol.toUpperCase() === 'ETH') {
      const wethAddr = getTokenAddress('WETH', chainId);
      if (wethAddr) {
        return wethAddr;
      }
    }
    
    // For unknown tokens, throw error instead of using symbol (0x API will reject it anyway)
    // This prevents silent failures and makes the issue clear
    throw new Error(
      `Token address not found for ${symbol} on chain ${chainId}. ` +
      `Token may not be supported or needs to be added to SUPPORTED_TOKENS configuration. ` +
      `Supported chains: Ethereum (1), Polygon (137), Arbitrum (42161). ` +
      `If ${symbol} is a valid token, add it to the token configuration.`
    );
  }

  /**
   * Get live price from 0x API (EVM chains only)
   * For Solana (chainId 101), use Jupiter/CoinGecko instead
   * Uses /swap/v2/quote endpoint (same as zeroExService)
   */
  async getLivePrice(
    chainId: number,
    sellToken: string,
    buyToken: string
  ): Promise<number> {
    // Solana doesn't use 0x API - should use Jupiter/CoinGecko
    if (chainId === 101) {
      throw new Error('Solana (chainId 101) should not use 0x API - use Jupiter/CoinGecko instead');
    }
    const cacheKey = `price:${chainId}:${sellToken}:${buyToken}`;
    
    // Check in-memory cache first (fastest)
    const cachedPrice = this.getCachedPrice(cacheKey);
    if (cachedPrice !== null) {
      return cachedPrice;
    }
    
    // Use rate limiter with high priority and caching
    return apiRateLimiter.request(
      async () => {
        // Check in-memory cache again (might have been set by another request)
        const cachedPrice = this.getCachedPrice(cacheKey);
        if (cachedPrice !== null) {
          return cachedPrice;
        }
        const maxRetries = 3;
        let lastError: any = null;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const chainConfig = getChainConfig(chainId);
            if (!chainConfig?.zeroXApiUrl) {
              throw new Error(
                `Unsupported chain: ${chainId}. ` +
                `Supported chains: Ethereum (1), Polygon (137), Arbitrum (42161). ` +
                `For Solana (101), use Jupiter/CoinGecko instead. ` +
                `Check your chain configuration in the codebase.`
              );
            }

            // Resolve token addresses (handles ETH -> special address)
            const sellTokenAddr = this.resolveTokenAddress(sellToken, chainId);
            const buyTokenAddr = this.resolveTokenAddress(buyToken, chainId);

            // Check if sellToken and buyToken are the same (invalid pair)
            if (sellTokenAddr === buyTokenAddr) {
              throw new Error(
                `Cannot get price for same token pair: ${sellToken} -> ${buyToken}. ` +
                `Token addresses resolved to the same value: ${sellTokenAddr}. ` +
                `Please use different tokens for price quotes.`
              );
            }
            
            // Use 1 full token for sellAmount (0x API prefers larger amounts)
            const sellTokenConfig = getTokenConfig(sellToken, chainId);
            const sellDecimals = sellTokenConfig?.decimals || 18;
            const sellAmount = sellDecimals === 6 
              ? '1000000' // 1 USDC (6 decimals)
              : '1000000000000000000'; // 1 token (18 decimals)
            
            // Taker address (required by 0x API docs) - use a dummy address for price quotes
            const takerAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // Dummy address for price quotes
            
            // Try /swap/permit2/quote endpoint first (from 0x API docs)
            let endpoint = `${chainConfig.zeroXApiUrl}/swap/permit2/quote`;
            let data: any;
            let endpointError: any = null;
            
            if (attempt === 0) {
              logger.info({ 
                chainId, 
                sellToken, 
                buyToken, 
                sellTokenAddr, 
                buyTokenAddr, 
                endpoint,
                sellAmount,
                taker: takerAddress,
                apiKey: config.dataProviders.zeroX.apiKey ? '***SET***' : 'MISSING',
              }, 'Fetching price from 0x API (trying permit2/quote)');
            }
            
            // Use 0x API v2 endpoints per official docs:
            // 1. /swap/allowance-holder/price (indicative price)
            // 2. /swap/permit2/price (indicative price with Permit2)
            endpoint = `${chainConfig.zeroXApiUrl}/swap/allowance-holder/price`;
            try {
              const response = await axios.get(endpoint, {
                params: {
                  chainId: chainId, // REQUIRED per docs
                  sellToken: sellTokenAddr,
                  buyToken: buyTokenAddr,
                  sellAmount: sellAmount,
                  slippageBps: 100, // Default 1% slippage (100 bps)
                  // taker is optional for price endpoint
                },
                headers: {
                  '0x-api-key': config.dataProviders.zeroX.apiKey,
                  '0x-version': 'v2', // REQUIRED per docs
                },
                timeout: 10000,
              });
              data = response.data;
            } catch (error: any) {
              endpointError = error;
              // If allowance-holder/price fails, try permit2/price
              if (attempt === 0) {
                logger.warn({ 
                  error: error.message, 
                  status: error.response?.status,
                  endpoint: 'allowance-holder/price'
                }, 'allowance-holder/price failed, trying permit2/price');
              }
              
              endpoint = `${chainConfig.zeroXApiUrl}/swap/permit2/price`;
              try {
                const response = await axios.get(endpoint, {
                  params: {
                    chainId: chainId, // REQUIRED per docs
                    sellToken: sellTokenAddr,
                    buyToken: buyTokenAddr,
                    sellAmount: sellAmount,
                    slippageBps: 100, // Default 1% slippage (100 bps)
                  },
                  headers: {
                    '0x-api-key': config.dataProviders.zeroX.apiKey,
                    '0x-version': 'v2', // REQUIRED per docs
                  },
                  timeout: 10000,
                });
                data = response.data;
              } catch (error3: any) {
                // All endpoints failed
                endpointError = error3;
                lastError = new Error(`All 0x API endpoints failed. Last error: ${error3.message}. Status: ${error3.response?.status}. Response: ${JSON.stringify(error3.response?.data)}`);
              }
            }
            
            // If all endpoints failed, handle retry logic
            if (!data && lastError) {
              // Check if error is retryable
              const isRetryable = this.isRetryableError(endpointError || lastError);
              
              // Special handling for rate limits (429)
              if (endpointError?.response?.status === 429) {
                const retryAfter = endpointError.response.headers['retry-after'];
                const delay = retryAfter 
                  ? parseInt(retryAfter) * 1000 
                  : 1000 * Math.pow(2, attempt); // Fallback to exponential backoff
                
                // Try to use cached price if available (first attempt only)
                if (attempt === 0) {
                  const cachedPrice = this.getCachedPrice(cacheKey);
                  if (cachedPrice !== null) {
                    logger.warn({ 
                      cachedPrice, 
                      retryAfter,
                      error: endpointError?.message 
                    }, 'Rate limited, using cached price');
                    return cachedPrice;
                  }
                }
                
                if (attempt < maxRetries - 1) {
                  logger.warn({ 
                    attempt: attempt + 1, 
                    maxRetries, 
                    delay, 
                    retryAfter,
                    error: endpointError?.message 
                  }, 'Rate limited, waiting before retry');
                  await new Promise(resolve => setTimeout(resolve, delay));
                  continue;
                }
              } else if (isRetryable && attempt < maxRetries - 1) {
                const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
                logger.warn({ 
                  attempt: attempt + 1, 
                  maxRetries, 
                  delay, 
                  error: endpointError?.message,
                  status: endpointError?.response?.status 
                }, 'Retrying 0x API call after endpoint failures');
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              }
              throw lastError;
            }

            if (!data) {
              throw new Error('Invalid response from 0x API: empty response');
            }

            // Extract price from response (different endpoints return different formats)
            let price: number;
            if (data.price) {
              // Direct price field (from /price endpoint)
              price = parseFloat(data.price);
            } else if (data.buyAmount && data.sellAmount) {
              // Quote response: price = buyAmount / sellAmount
              const buyAmount = parseFloat(data.buyAmount);
              const sellAmountNum = parseFloat(data.sellAmount);
              if (sellAmountNum > 0) {
                price = buyAmount / sellAmountNum;
              } else {
                throw new Error(
                  `Invalid sellAmount in 0x API response: ${data.sellAmount}. ` +
                  `Chain: ${chainId}, Pair: ${sellToken}/${buyToken}. ` +
                  `This may indicate an issue with the token pair or API response format.`
                );
              }
            } else if (data.buyAmount && sellAmount) {
              // Quote response with only buyAmount (sellAmount is what we sent)
              const buyAmount = parseFloat(data.buyAmount);
              const sellAmountNum = parseFloat(sellAmount);
              if (sellAmountNum > 0) {
                price = buyAmount / sellAmountNum;
              } else {
                throw new Error(
                  `Invalid sellAmount calculation: ${sellAmount}. ` +
                  `Chain: ${chainId}, Pair: ${sellToken}/${buyToken}. ` +
                  `Check token decimals configuration.`
                );
              }
            } else {
              throw new Error(
                `Invalid response from 0x API: missing price data. ` +
                `Chain: ${chainId}, Pair: ${sellToken}/${buyToken}. ` +
                `Response: ${JSON.stringify(data)}. ` +
                `Check if the token pair is supported on this chain.`
              );
            }
            
            if (!Number.isFinite(price) || price <= 0) {
              throw new Error(
                `Invalid price from 0x API: ${price}. ` +
                `Chain: ${chainId}, Pair: ${sellToken}/${buyToken}. ` +
                `Price must be a positive number. Check token addresses and chain configuration.`
              );
            }
            
            // Cache in memory (first layer)
            this.setCachedPrice(cacheKey, price);
            
            // Also cache in Redis if available (second layer, for faster access across instances)
            if (redis) {
              redis.set(cacheKey, price.toString(), 'EX', 10).catch(() => {}); // Non-blocking, 10s cache
            }

            logger.info({ chainId, sellToken, buyToken, price, sellTokenAddr, buyTokenAddr, attempt: attempt + 1 }, '✅ Price fetched successfully from 0x API');
            return price;
          } catch (error: any) {
            lastError = error;
            const isRetryable = this.isRetryableError(error);
            
            // Special handling for rate limits (429)
            if (error.response?.status === 429) {
              const retryAfter = error.response.headers['retry-after'];
              const delay = retryAfter 
                ? parseInt(retryAfter) * 1000 
                : 1000 * Math.pow(2, attempt); // Fallback to exponential backoff
              
              // Try to use cached price if available (first attempt only)
              if (attempt === 0) {
                const cachedPrice = this.getCachedPrice(cacheKey);
                if (cachedPrice !== null) {
                  logger.warn({ 
                    cachedPrice, 
                    retryAfter,
                    error: error.message 
                  }, 'Rate limited, using cached price');
                  return cachedPrice;
                }
              }
              
              if (attempt < maxRetries - 1) {
                logger.warn({ 
                  attempt: attempt + 1, 
                  maxRetries, 
                  delay, 
                  retryAfter,
                  error: error.message 
                }, 'Rate limited, waiting before retry');
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              }
            }
            
            // Don't retry validation errors or non-retryable errors
            if (!isRetryable || attempt >= maxRetries - 1) {
              // Log detailed error information
              const sellTokenAddr = this.resolveTokenAddress(sellToken, chainId);
              const buyTokenAddr = this.resolveTokenAddress(buyToken, chainId);
              const chainConfig = getChainConfig(chainId);
              
              // Build helpful error message with troubleshooting hints
              let errorMessage = `Failed to fetch price from 0x API after ${attempt + 1} attempt(s). `;
              errorMessage += `Chain: ${chainId}, Pair: ${sellToken}/${buyToken}. `;
              
              if (error.response?.status === 401 || error.response?.status === 403) {
                errorMessage += `Authentication failed. Check your ZEROX_API_KEY environment variable. `;
                errorMessage += `API key is ${config.dataProviders.zeroX.apiKey ? 'set' : 'missing'}.`;
              } else if (error.response?.status === 400) {
                errorMessage += `Invalid request. Check token addresses: ${sellTokenAddr} -> ${buyTokenAddr}. `;
                errorMessage += `Token may not be supported on chain ${chainId}.`;
              } else if (error.response?.status === 404) {
                errorMessage += `Endpoint not found. Token pair may not be available: ${sellToken}/${buyToken}. `;
                errorMessage += `Try a different token pair or check chain support.`;
              } else if (error.response?.status === 429) {
                errorMessage += `Rate limit exceeded. The system will retry automatically. `;
                errorMessage += `Consider reducing request frequency or upgrading your API plan.`;
              } else if (error.response?.status >= 500) {
                errorMessage += `Server error (${error.response.status}). This is a temporary issue. `;
                errorMessage += `The system will retry automatically.`;
              } else if (!error.response) {
                errorMessage += `Network error: ${error.message}. `;
                errorMessage += `Check your internet connection and 0x API status.`;
              } else {
                errorMessage += `Error: ${error.message}. Status: ${error.response.status}.`;
              }
              
              logger.error({ 
                chainId, 
                sellToken, 
                buyToken, 
                sellTokenAddr,
                buyTokenAddr,
                endpoint: chainConfig ? `${chainConfig.zeroXApiUrl}/swap/v1/quote` : 'unknown',
                error: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                responseData: error.response?.data,
                apiKeySet: !!config.dataProviders.zeroX.apiKey,
                attempt: attempt + 1,
                maxRetries,
                isRetryable,
                troubleshooting: errorMessage
              }, '❌ Failed to fetch price from 0x API');
              
              // Throw error with helpful message
              const enhancedError = new Error(errorMessage);
              enhancedError.stack = error.stack;
              throw enhancedError;
            }
            
            // Retry with exponential backoff
            const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
            logger.warn({ 
              attempt: attempt + 1, 
              maxRetries, 
              delay, 
              error: error.message,
              status: error.response?.status 
            }, 'Retrying 0x API call');
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
        // After all retries failed, try to return stale cached price (graceful degradation)
        const staleCache = this.getCachedPrice(cacheKey);
        if (staleCache !== null) {
          logger.warn({ 
            cachedPrice: staleCache, 
            error: lastError?.message,
            chainId,
            sellToken,
            buyToken
          }, 'Using stale cached price after API failure (graceful degradation)');
          return staleCache;
        }
        
        // Also try Redis cache as last resort
        if (redis) {
          try {
            const redisCached = await redis.get(cacheKey);
            if (redisCached) {
              const stalePrice = parseFloat(redisCached);
              if (Number.isFinite(stalePrice) && stalePrice > 0) {
                logger.warn({ 
                  cachedPrice: stalePrice, 
                  error: lastError?.message,
                  chainId,
                  sellToken,
                  buyToken
                }, 'Using stale Redis cached price after API failure (graceful degradation)');
                // Update in-memory cache with stale value
                this.setCachedPrice(cacheKey, stalePrice);
                return stalePrice;
              }
            }
          } catch (redisError) {
            // Ignore Redis errors, just throw original error
          }
        }
        
        // Should never reach here, but throw last error if we do
        throw lastError || new Error(`Failed to fetch price from 0x API after all retries. Chain: ${chainId}, Pair: ${sellToken}/${buyToken}. Check API key and token addresses.`);
      },
      'high', // High priority for live prices
      cacheKey,
      10 // 10 second cache TTL (increased from 5s)
    );
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
    // For Solana, use real historical data from CoinGecko/Birdeye
    if (chainId === 101) {
      logger.info({ fromTs, toTs, interval }, 'Fetching Solana historical data');
      const intervalStr = interval <= 300 ? '5m' : interval <= 900 ? '15m' : interval <= 3600 ? '1h' : interval <= 14400 ? '4h' : '1d';
      return await solanaHistoricalData.getHistoricalCandles(fromTs, toTs, intervalStr as '5m' | '15m' | '1h' | '4h' | '1d');
    }

    const candles: Candle[] = [];
    const chainConfig = getChainConfig(chainId);
    
    if (!chainConfig?.zeroXApiUrl) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    // Resolve token addresses (handles ETH -> special address)
    const sellTokenAddr = this.resolveTokenAddress(sellToken, chainId);
    const buyTokenAddr = this.resolveTokenAddress(buyToken, chainId);

    // Check cache first (longer TTL for historical data)
    const cacheKey = `hist:${chainId}:${sellToken}:${buyToken}:${fromTs}:${toTs}:${interval}`;
    
    // Use rate limiter with low priority and longer cache (1 hour)
    return apiRateLimiter.request(
      async () => {
        const candles: Candle[] = [];

        // Track 404 errors to avoid spam logging
        let last404LogTime = 0;
        const LOG_404_INTERVAL = 60000; // Log 404s at most once per minute
        let hasLogged404 = false;
        
        // Fetch historical trades in chunks (optimize chunk size to reduce API calls)
        const chunkSize = Math.max(interval * 24, 86400); // Fetch up to 24 intervals or 1 day at once
        
        for (let ts = fromTs; ts < toTs; ts += chunkSize) {
          const chunkEnd = Math.min(ts + chunkSize, toTs);
          
          // Retry logic for chunk fetching (up to 2 retries)
          const maxChunkRetries = 2;
          let chunkSuccess = false;
          
          for (let chunkAttempt = 0; chunkAttempt <= maxChunkRetries && !chunkSuccess; chunkAttempt++) {
            try {
              // Resolve token addresses for historical trades
              const sellTokenAddr = this.resolveTokenAddress(sellToken, chainId);
              const buyTokenAddr = this.resolveTokenAddress(buyToken, chainId);
              
              const { data } = await axios.get(`${chainConfig.zeroXApiUrl}/swap/v1/historicalTrades`, {
                params: {
                  sellToken: sellTokenAddr,
                  buyToken: buyTokenAddr,
                  startTimestamp: Math.floor(ts / 1000), // 0x expects seconds
                  endTimestamp: Math.floor(chunkEnd / 1000),
                  limit: 1000,
                },
                headers: {
                  '0x-api-key': config.dataProviders.zeroX.apiKey,
                },
                timeout: 10000,
              });

              // Handle error responses from 0x API
              if (data?.error) {
                logger.warn({ error: data.error, ts, chunkAttempt }, '0x API returned error');
                if (chunkAttempt < maxChunkRetries) {
                  const delay = 1000 * Math.pow(2, chunkAttempt); // 1s, 2s
                  await new Promise(resolve => setTimeout(resolve, delay));
                  continue;
                }
                break; // Skip this chunk after retries
              }

              if (data?.trades && Array.isArray(data.trades) && data.trades.length > 0) {
                // Aggregate trades into candles for this chunk
                const chunkCandles = this.buildCandlesFromTrades(
                  data.trades.map((t: any) => ({
                    price: parseFloat(t.price || '0'),
                    timestamp: (parseFloat(t.timestamp) || ts / 1000) * 1000, // Convert to milliseconds
                    volume: parseFloat(t.sellAmount || '0'),
                  })),
                  interval * 1000 // Convert to milliseconds
                );
                candles.push(...chunkCandles);
                chunkSuccess = true; // Mark chunk as successful
              } else {
                chunkSuccess = true; // No trades but successful response
              }
            } catch (error: any) {
              // Suppress repeated 404 errors (endpoint may not be available)
              const is404 = error.response?.status === 404 || error.message?.includes('404');
              const isRetryable = this.isRetryableError(error);
              const now = Date.now();
              
              if (is404) {
                // Only log 404s once per minute to avoid spam
                if (!hasLogged404 || (now - last404LogTime) > LOG_404_INTERVAL) {
                  logger.warn({ 
                    chainId, 
                    sellToken, 
                    buyToken,
                    message: '0x historicalTrades endpoint returned 404 (endpoint may not be available). Using alternative data sources.'
                  }, 'Historical trades endpoint unavailable');
                  hasLogged404 = true;
                  last404LogTime = now;
                }
                // Skip this endpoint and continue - will use alternative data sources
                break; // Exit loop since endpoint doesn't exist
              } else if (isRetryable && chunkAttempt < maxChunkRetries) {
                // Retry on retryable errors
                const delay = 1000 * Math.pow(2, chunkAttempt); // 1s, 2s
                logger.warn({ 
                  chunkAttempt: chunkAttempt + 1, 
                  maxChunkRetries, 
                  delay, 
                  error: error.message,
                  ts 
                }, 'Retrying historical trades chunk fetch');
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              } else {
                // Log other errors normally but less frequently
                if ((now - last404LogTime) > LOG_404_INTERVAL) {
                  logger.warn({ 
                    error: error.message, 
                    ts, 
                    chainId,
                    chunkAttempt: chunkAttempt + 1,
                    maxChunkRetries 
                  }, 'Failed to fetch historical trades for period after retries');
                  last404LogTime = now;
                }
                // Continue to next chunk even if this one failed
                break;
              }
            }
          }
          // Continue to next period
        }

        // Validate data is real (not synthetic) before returning
        const sortedCandles = candles.sort((a, b) => a.timestamp - b.timestamp);
        
        if (sortedCandles.length > 0) {
          // Validate all candles
          if (!dataValidator.validateAndLog(sortedCandles, `0x-${chainId}`)) {
            logger.error({ chainId, sellToken, buyToken }, 'Data validation failed - rejected fake/synthetic data');
            throw new Error('Data validation failed - rejected fake/synthetic data');
          }
          
          // Reject fake data
          const fakeCheck = dataValidator.rejectFakeData(sortedCandles);
          if (!fakeCheck.valid) {
            logger.error({ chainId, reason: fakeCheck.reason }, 'Rejected fake data from 0x API');
            throw new Error(`Rejected fake data: ${fakeCheck.reason}`);
          }
        }
        
        return sortedCandles;
      },
      'low', // Low priority for historical data
      cacheKey,
      3600 // 1 hour cache TTL for historical data
    );
  }

  /**
   * Get latest market snapshot (price + volume)
   */
  async getLatestSnapshot(
    chainId: number,
    sellToken: string,
    buyToken: string,
    includeVolume: boolean = false // Make volume optional to reduce API calls
  ): Promise<{ price: number; volume24h?: number }> {
    const price = await this.getLivePrice(chainId, sellToken, buyToken);
    
    let volume24h: number | undefined;
    if (includeVolume) {
      // Only fetch volume if explicitly requested
      // Use cached volume if available
      const volumeCacheKey = `volume:${chainId}:${sellToken}:${buyToken}`;
      const cachedVolume = await cacheClient.get<number>(volumeCacheKey);
      if (cachedVolume !== null) {
        volume24h = cachedVolume;
        logger.debug({ volume24h, chainId, sellToken, buyToken }, 'Using cached 24h volume');
      } else {
        // Fetch and cache volume (1 hour TTL)
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
          
          // Cache volume for 1 hour
          if (volume24h > 0) {
            await cacheClient.set(volumeCacheKey, volume24h, 3600);
          }
        } catch (error) {
          logger.warn({ error, chainId, sellToken, buyToken }, 'Failed to fetch 24h volume');
        }
      }
    }

    return { price, volume24h };
  }

  /**
   * Fetch prices for multiple token pairs in parallel
   * Uses batchRequest for efficient parallel execution
   */
  async getBatchPrices(
    requests: Array<{ chainId: number; sellToken: string; buyToken: string }>
  ): Promise<Array<{ price: number; error?: Error; chainId: number; sellToken: string; buyToken: string }>> {
    const results = await apiRateLimiter.batchRequest(
      requests.map(req => ({
        fn: () => this.getLivePrice(req.chainId, req.sellToken, req.buyToken),
        priority: 'high' as const,
        cacheKey: `price:${req.chainId}:${req.sellToken}:${req.buyToken}`
      })),
      5 // Max 5 concurrent requests
    );
    
    // Map results back to original requests with error handling
    return requests.map((req, index) => {
      const result = results[index];
      if (result instanceof Error) {
        return {
          chainId: req.chainId,
          sellToken: req.sellToken,
          buyToken: req.buyToken,
          price: 0,
          error: result
        };
      }
      return {
        chainId: req.chainId,
        sellToken: req.sellToken,
        buyToken: req.buyToken,
        price: result as number
      };
    });
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

