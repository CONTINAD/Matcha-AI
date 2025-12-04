import Redis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../config/logger';

type MemoryEntry = {
  value: string;
  expiresAt: number;
};

export class CacheClient {
  private redis?: Redis;
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly defaultTtlSeconds: number;
  private readonly stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    invalidations: 0,
  };

  constructor() {
    this.defaultTtlSeconds = config.dataProviders.cache.defaultTtlSeconds || 30;

    if (config.dataProviders.cache.redisUrl) {
      this.redis = new Redis(config.dataProviders.cache.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });

      this.redis.on('error', (error) => {
        logger.warn({ error }, 'Redis connection error, falling back to in-memory cache');
        this.redis = undefined;
      });

      this.redis.connect().catch((error) => {
        logger.warn({ error }, 'Failed to connect to Redis, using in-memory cache');
        this.redis = undefined;
      });
    }

    // Clean up expired memory entries periodically
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.memory.entries()) {
        if (entry.expiresAt <= now) {
          this.memory.delete(key);
        }
      }
    }, 60000); // Every minute
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis) {
        const cached = await this.redis.get(key);
        if (cached) {
          this.stats.hits++;
          return JSON.parse(cached) as T;
        }
      }
    } catch (error) {
      logger.warn({ error, key }, 'Redis get failed, falling back to memory');
    }

    const entry = this.memory.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      this.stats.hits++;
      return JSON.parse(entry.value) as T;
    }

    this.stats.misses++;
    return null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const payload = JSON.stringify(value);
    this.stats.sets++;

    try {
      if (this.redis) {
        await this.redis.set(key, payload, 'EX', ttl);
      }
    } catch (error) {
      logger.warn({ error, key }, 'Redis set failed, caching in memory only');
    }

    this.memory.set(key, {
      value: payload,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  /**
   * Invalidate cache entry (remove from both Redis and memory)
   */
  async invalidate(key: string): Promise<void> {
    this.stats.invalidations++;
    
    try {
      if (this.redis) {
        await this.redis.del(key);
      }
    } catch (error) {
      logger.warn({ error, key }, 'Redis invalidation failed');
    }

    this.memory.delete(key);
  }

  /**
   * Invalidate all entries matching a pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let count = 0;
    
    try {
      if (this.redis) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          count = keys.length;
        }
      }
    } catch (error) {
      logger.warn({ error, pattern }, 'Redis pattern invalidation failed');
    }

    // Also invalidate from memory
    for (const key of this.memory.keys()) {
      if (key.includes(pattern.replace('*', ''))) {
        this.memory.delete(key);
        count++;
      }
    }

    this.stats.invalidations += count;
    return count;
  }

  /**
   * Warm cache with frequently accessed data
   */
  async warmCache(entries: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    logger.info({ count: entries.length }, 'Warming cache');
    
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.ttl);
    }
    
    logger.info({ count: entries.length }, 'Cache warmed');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      invalidations: this.stats.invalidations,
      hitRate: hitRate.toFixed(2) + '%',
      memorySize: this.memory.size,
      redisConnected: !!this.redis,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.sets = 0;
    this.stats.invalidations = 0;
  }
}

export const cacheClient = new CacheClient();
