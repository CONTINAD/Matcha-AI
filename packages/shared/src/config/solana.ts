import type { TokenConfig } from '../types';

export interface SolanaTokenConfig {
  symbol: string;
  mint: string; // Token mint address
  decimals: number;
  coingeckoId?: string;
}

export const SOLANA_TOKENS: SolanaTokenConfig[] = [
  {
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    decimals: 9,
    coingeckoId: 'solana',
  },
  {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    coingeckoId: 'usd-coin',
  },
  {
    symbol: 'USDT',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    coingeckoId: 'tether',
  },
  {
    symbol: 'BONK',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    decimals: 5,
    coingeckoId: 'bonk',
  },
  {
    symbol: 'RAY',
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    decimals: 6,
    coingeckoId: 'raydium',
  },
];

export function getSolanaTokenConfig(symbol: string): SolanaTokenConfig | undefined {
  return SOLANA_TOKENS.find((token) => token.symbol === symbol);
}

export function getSolanaTokenMint(symbol: string): string | undefined {
  return getSolanaTokenConfig(symbol)?.mint;
}


