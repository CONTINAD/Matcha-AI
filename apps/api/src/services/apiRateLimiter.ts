import { logger } from '../config/logger';
import { cacheClient } from './cache';

interface QueuedRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  fn: () => Promise<T>;
  priority: 'high' | 'low';
  timestamp: number;
}

/**
 * Intelligent API Rate Limiter for 0x.org API
 * - Tracks API credit usage
 * - Implements priority queue (live > historical)
 * - Batches requests where possible
 * - Smart throttling to avoid spam
 */
export class APIRateLimiter {
  private queue: QueuedRequest<any>[] = [];
  private processing = false;
  private creditsUsed = 0;
  private creditsLimit = 100000; // Daily limit (adjust based on your plan)
  private requestsPerMinute = 60; // Conservative limit
  private requestTimestamps: number[] = [];
  private readonly CACHE_TTL_LIVE = 5; // 5 seconds for live prices
  private readonly CACHE_TTL_HISTORICAL = 3600; // 1 hour for historical data

  /**
   * Request with priority queuing
   */
  async request<T>(
    fn: () => Promise<T>,
    priority: 'high' | 'low' = 'low',
    cacheKey?: string,
    cacheTtl?: number
  ): Promise<T> {
    // Check cache first if cacheKey provided
    if (cacheKey) {
      const cached = await cacheClient.get<T>(cacheKey);
      if (cached !== null) {
        logger.debug({ cacheKey, priority }, 'Cache hit - skipping API call');
        return cached;
      }
    }

    return new Promise<T>((resolve, reject) => {
      // Add to queue with priority
      this.queue.push({
        resolve,
        reject,
        fn,
        priority,
        timestamp: Date.now(),
      });

      // Sort queue by priority (high first, then by timestamp)
      this.queue.sort((a, b) => {
        if (a.priority === 'high' && b.priority === 'low') return -1;
        if (a.priority === 'low' && b.priority === 'high') return 1;
        return a.timestamp - b.timestamp;
      });

      // Start processing if not already
      if (!this.processing) {
        this.processQueue();
      }
    }).then(async (result) => {
      // Cache result if cacheKey provided
      if (cacheKey && result !== null && result !== undefined) {
        const ttl = cacheTtl || (priority === 'high' ? this.CACHE_TTL_LIVE : this.CACHE_TTL_HISTORICAL);
        await cacheClient.set(cacheKey, result, ttl);
      }
      return result;
    });
  }

  /**
   * Process queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      // Check rate limit
      await this.enforceRateLimit();

      // Check credit limit
      if (this.creditsUsed >= this.creditsLimit) {
        logger.warn({ creditsUsed: this.creditsUsed, limit: this.creditsLimit }, 'API credit limit reached, pausing requests');
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
        this.creditsUsed = 0; // Reset (assuming daily limit)
        continue;
      }

      const request = this.queue.shift();
      if (!request) break;

      try {
        const startTime = Date.now();
        const result = await request.fn();
        const duration = Date.now() - startTime;

        // Track credits (estimate: 1 credit per request)
        // Note: Different endpoints may use different credits, but we estimate conservatively
        this.creditsUsed += 1;
        this.requestTimestamps.push(Date.now());

        // Clean old timestamps (keep only last minute)
        const oneMinuteAgo = Date.now() - 60000;
        this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);

        logger.debug({ 
          priority: request.priority, 
          duration, 
          creditsUsed: this.creditsUsed,
          queueLength: this.queue.length 
        }, 'API request completed');

        request.resolve(result);
      } catch (error: any) {
        // Parse rate limit headers if available (for 0x API)
        if (error.response?.headers) {
          const remaining = error.response.headers['x-ratelimit-remaining'];
          const limit = error.response.headers['x-ratelimit-limit'];
          const reset = error.response.headers['x-ratelimit-reset'];
          
          if (remaining !== undefined && limit !== undefined) {
            const remainingNum = parseInt(remaining);
            const limitNum = parseInt(limit);
            
            // Adjust request rate based on remaining quota
            if (remainingNum < limitNum * 0.1) {
              // Less than 10% remaining - slow down
              this.requestsPerMinute = Math.max(10, Math.floor(limitNum / 10));
              logger.warn({ 
                remaining: remainingNum, 
                limit: limitNum,
                newRateLimit: this.requestsPerMinute 
              }, 'Rate limit quota low, reducing request rate');
            } else if (remainingNum > limitNum * 0.5) {
              // More than 50% remaining - can speed up slightly
              this.requestsPerMinute = Math.min(60, limitNum);
            }
            
            if (reset) {
              const resetTime = parseInt(reset) * 1000; // Convert to milliseconds
              const timeUntilReset = resetTime - Date.now();
              if (timeUntilReset > 0 && remainingNum === 0) {
                logger.warn({ 
                  timeUntilReset: Math.ceil(timeUntilReset / 1000),
                  resetTime: new Date(resetTime).toISOString()
                }, 'Rate limit exhausted, will reset soon');
              }
            }
          }
        }
        
        logger.error({ 
          error: error.message || error, 
          priority: request.priority,
          status: error.response?.status,
          rateLimitRemaining: error.response?.headers?.['x-ratelimit-remaining']
        }, 'API request failed');
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }

      // Small delay between requests to avoid hammering
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }
    }

    this.processing = false;
  }

  /**
   * Enforce rate limit (requests per minute)
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Count requests in last minute
    const recentRequests = this.requestTimestamps.filter(ts => ts > oneMinuteAgo).length;

    if (recentRequests >= this.requestsPerMinute) {
      const oldestRequest = Math.min(...this.requestTimestamps.filter(ts => ts > oneMinuteAgo));
      const waitTime = 60000 - (now - oldestRequest) + 100; // Wait until oldest request is 1 minute old
      
      if (waitTime > 0) {
        logger.debug({ waitTime, recentRequests, limit: this.requestsPerMinute }, 'Rate limit reached, waiting');
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Batch multiple requests together (for parallel execution)
   */
  async batchRequest<T>(
    requests: Array<{ fn: () => Promise<T>; priority?: 'high' | 'low'; cacheKey?: string }>,
    maxConcurrent: number = 5
  ): Promise<T[]> {
    const results: T[] = [];
    const errors: Error[] = [];

    // Process in batches
    for (let i = 0; i < requests.length; i += maxConcurrent) {
      const batch = requests.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(req => 
        this.request(
          req.fn,
          req.priority || 'low',
          req.cacheKey
        ).catch(error => {
          errors.push(error instanceof Error ? error : new Error(String(error)));
          return null;
        })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(r => r !== null) as T[]);
    }

    if (errors.length > 0 && results.length === 0) {
      throw errors[0]; // Throw first error if all failed
    }

    return results;
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      creditsUsed: this.creditsUsed,
      creditsLimit: this.creditsLimit,
      requestsLastMinute: this.requestTimestamps.filter(ts => ts > Date.now() - 60000).length,
      requestsPerMinute: this.requestsPerMinute,
      processing: this.processing,
    };
  }

  /**
   * Reset credit counter (call daily)
   */
  resetCredits(): void {
    this.creditsUsed = 0;
    logger.info('API credit counter reset');
  }
}

export const apiRateLimiter = new APIRateLimiter();

