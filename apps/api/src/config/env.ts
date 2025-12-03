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
    coinGecko: {
      apiKey: optionalEnv('COINGECKO_API_KEY'),
      baseUrl: optionalEnv('COINGECKO_API_URL', 'https://pro-api.coingecko.com/api/v3'),
    },
    binance: {
      restUrl: optionalEnv('BINANCE_REST_URL', 'https://api.binance.com'),
      wsUrl: optionalEnv('BINANCE_WS_URL', 'wss://stream.binance.com:9443/stream'),
      defaultQuote: optionalEnv('BINANCE_DEFAULT_QUOTE', 'USDT'),
    },
    theGraph: {
      uniswapV3Url: optionalEnv(
        'UNISWAP_V3_SUBGRAPH',
        'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3'
      ),
    },
    cache: {
      redisUrl: optionalEnv('REDIS_URL'),
      defaultTtlSeconds: parseInt(optionalEnv('CACHE_TTL_SECONDS', '30') || '30', 10),
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
