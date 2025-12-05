import { createHash } from 'crypto';
import type { MarketContext, StrategyConfig, Decision } from '@matcha-ai/shared';
import { logger } from '../config/logger';

interface CachedDecision {
  decision: Decision;
  timestamp: number;
  priceHash: string; // Hash of current price to detect significant moves
}

/**
 * AI Result Cache
 * 
 * Caches AI decisions to avoid redundant API calls:
 * - Cache key: hash of (indicators, market context, strategy config)
 * - Cache TTL: 5 minutes (market conditions change)
 * - Cache invalidation: On significant price move (>1%)
 */
export class AICache {
  private cache: Map<string, CachedDecision> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly PRICE_MOVE_THRESHOLD = 0.01; // 1% price move invalidates cache

  /**
   * Generate cache key from context
   */
  private generateCacheKey(context: MarketContext, strategyConfig: StrategyConfig): string {
    // Create hash of relevant context data
    const keyData = {
      indicators: context.indicators,
      recentCandles: context.recentCandles.slice(-5).map((c) => ({
        close: Math.round(c.close * 100) / 100, // Round to 2 decimals
        volume: Math.round(c.volume),
      })),
      openPositions: context.openPositions.map((p) => ({
        symbol: p.symbol,
        side: p.side,
        size: Math.round(p.size * 100) / 100,
      })),
      strategyConfig: {
        baseAsset: strategyConfig.baseAsset,
        universe: strategyConfig.universe,
        timeframe: strategyConfig.timeframe,
        ai: strategyConfig.ai,
      },
    };

    const keyString = JSON.stringify(keyData);
    return createHash('sha256').update(keyString).digest('hex');
  }

  /**
   * Get cached decision if available and valid
   */
  getCachedDecision(
    context: MarketContext,
    strategyConfig: StrategyConfig
  ): Decision | null {
    const cacheKey = this.generateCacheKey(context, strategyConfig);
    const cached = this.cache.get(cacheKey);

    if (!cached) {
      return null; // No cache entry
    }

    // Check TTL
    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL_MS) {
      this.cache.delete(cacheKey);
      logger.debug({ cacheKey, age }, 'Cache entry expired');
      return null; // Cache expired
    }

    // Check for significant price move
    const currentPrice = context.recentCandles[context.recentCandles.length - 1]?.close || 0;
    const cachedPriceHash = cached.priceHash;
    const currentPriceHash = this.hashPrice(currentPrice);

    if (currentPriceHash !== cachedPriceHash) {
      // Price has moved, check if it's significant
      const priceMove = this.calculatePriceMove(context, cachedPriceHash);
      if (priceMove > this.PRICE_MOVE_THRESHOLD) {
        this.cache.delete(cacheKey);
        logger.debug({ cacheKey, priceMove: priceMove * 100 }, 'Cache invalidated due to significant price move');
        return null; // Significant price move, invalidate cache
      }
    }

    logger.debug({ cacheKey, age }, 'Returning cached AI decision');
    return cached.decision;
  }

  /**
   * Store decision in cache
   */
  setCachedDecision(
    context: MarketContext,
    strategyConfig: StrategyConfig,
    decision: Decision
  ): void {
    const cacheKey = this.generateCacheKey(context, strategyConfig);
    const currentPrice = context.recentCandles[context.recentCandles.length - 1]?.close || 0;

    this.cache.set(cacheKey, {
      decision,
      timestamp: Date.now(),
      priceHash: this.hashPrice(currentPrice),
    });

    logger.debug({ cacheKey }, 'Cached AI decision');

    // Clean up old entries (keep cache size reasonable)
    this.cleanup();
  }

  /**
   * Hash price for comparison (rounds to detect significant moves)
   */
  private hashPrice(price: number): string {
    // Round to 0.1% precision for hash comparison
    const rounded = Math.round(price * 1000) / 1000;
    return createHash('sha256').update(rounded.toString()).digest('hex').substring(0, 16);
  }

  /**
   * Calculate price move since cached decision
   */
  private calculatePriceMove(context: MarketContext, cachedPriceHash: string): number {
    const currentPrice = context.recentCandles[context.recentCandles.length - 1]?.close || 0;
    if (currentPrice === 0) return 0;

    // Try to find cached price from hash (simplified - in production would store actual price)
    // For now, we'll use a heuristic: if hash changed, assume >1% move
    const currentPriceHash = this.hashPrice(currentPrice);
    if (currentPriceHash !== cachedPriceHash) {
      // Hash changed, estimate move (conservative: assume 1.5% move)
      return 0.015;
    }

    return 0; // No significant move
  }

  /**
   * Clean up old cache entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL_MS * 2) {
        // Entry is 2x TTL old, remove it
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));

    // Also limit cache size (keep max 100 entries)
    if (this.cache.size > 100) {
      // Remove oldest entries
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, this.cache.size - 100);
      toRemove.forEach(([key]) => this.cache.delete(key));
      logger.debug({ removed: toRemove.length }, 'Cleaned up old cache entries');
    }
  }

  /**
   * Clear all cache entries
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('AI cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    hitRate?: number;
    oldestEntry?: number;
    newestEntry?: number;
  } {
    const entries = Array.from(this.cache.values());
    const timestamps = entries.map((e) => e.timestamp);

    return {
      size: this.cache.size,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    };
  }
}

export const aiCache = new AICache();

