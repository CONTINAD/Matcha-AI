import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (two levels up from apps/api/src/config)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
// Also try loading from current directory as fallback
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue?: string): string | undefined {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value;
}

export const config = {
  openai: {
    apiKey: requireEnv('OPENAI_API_KEY'),
  },
  zeroX: {
    apiKey: requireEnv('ZEROX_API_KEY'),
  },
  database: {
    url: requireEnv('DATABASE_URL'),
  },
  dataProviders: {
    zeroX: {
      apiKey: requireEnv('ZEROX_API_KEY'),
      baseUrl: optionalEnv('ZEROX_BASE_URL', 'https://api.0x.org'),
    },
    cache: {
      redisUrl: optionalEnv('REDIS_URL'),
      defaultTtlSeconds: parseInt(optionalEnv('CACHE_TTL_SECONDS', '3') || '3', 10), // 3s for live prices
    },
  },
  server: {
    port: parseInt(process.env.PORT_API || '4000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  observability: {
    enableMetrics: optionalEnv('ENABLE_METRICS', 'true') !== 'false',
    serviceName: optionalEnv('SERVICE_NAME', 'matcha-api'),
  },
  trading: {
    enableSolanaLive: optionalEnv('ENABLE_SOLANA_LIVE', 'false') === 'true',
  },
} as const;
