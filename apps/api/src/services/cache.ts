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
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis) {
        const cached = await this.redis.get(key);
        if (cached) {
          return JSON.parse(cached) as T;
        }
      }
    } catch (error) {
      logger.warn({ error, key }, 'Redis get failed, falling back to memory');
    }

    const entry = this.memory.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return JSON.parse(entry.value) as T;
    }

    return null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const payload = JSON.stringify(value);

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
}

export const cacheClient = new CacheClient();
