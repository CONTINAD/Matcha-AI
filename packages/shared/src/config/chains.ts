import type { ChainConfig, TokenConfig } from '../types';

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    zeroXApiUrl: 'https://api.0x.org',
  },
  {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
    zeroXApiUrl: 'https://polygon.api.0x.org',
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    zeroXApiUrl: 'https://arbitrum.api.0x.org',
  },
  {
    chainId: 101, // Solana Mainnet (using 101 as standard Solana chain ID)
    name: 'Solana Mainnet',
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    zeroXApiUrl: 'https://quote-api.jup.ag/v6', // Jupiter for Solana (0x doesn't support Solana)
  },
];

export const SUPPORTED_TOKENS: TokenConfig[] = [
  // Ethereum Mainnet
  {
    symbol: 'USDC',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    chainId: 1,
    coingeckoId: 'usd-coin',
    binanceSymbol: 'USDC',
  },
  {
    symbol: 'USDT',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    chainId: 1,
    coingeckoId: 'tether',
    binanceSymbol: 'USDT',
  },
  {
    symbol: 'WETH',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
    chainId: 1,
    coingeckoId: 'weth',
    binanceSymbol: 'ETH',
  },
  {
    symbol: 'DAI',
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    decimals: 18,
    chainId: 1,
    coingeckoId: 'dai',
    binanceSymbol: 'DAI',
  },
  // Polygon
  {
    symbol: 'USDC',
    address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    decimals: 6,
    chainId: 137,
    coingeckoId: 'usd-coin',
    binanceSymbol: 'USDC',
  },
  {
    symbol: 'USDT',
    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    decimals: 6,
    chainId: 137,
    coingeckoId: 'tether',
    binanceSymbol: 'USDT',
  },
  {
    symbol: 'WETH',
    address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    decimals: 18,
    chainId: 137,
    coingeckoId: 'weth',
    binanceSymbol: 'ETH',
  },
  // Arbitrum
  {
    symbol: 'USDC',
    address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    decimals: 6,
    chainId: 42161,
    coingeckoId: 'usd-coin',
    binanceSymbol: 'USDC',
  },
  {
    symbol: 'USDT',
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6,
    chainId: 42161,
    coingeckoId: 'tether',
    binanceSymbol: 'USDT',
  },
  {
    symbol: 'WETH',
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    decimals: 18,
    chainId: 42161,
    coingeckoId: 'weth',
    binanceSymbol: 'ETH',
  },
  // Solana Mainnet
  {
    symbol: 'SOL',
    address: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    decimals: 9,
    chainId: 101,
    coingeckoId: 'solana',
    binanceSymbol: 'SOL',
  },
  {
    symbol: 'USDC',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC on Solana
    decimals: 6,
    chainId: 101,
    coingeckoId: 'usd-coin',
    binanceSymbol: 'USDC',
  },
  {
    symbol: 'USDT',
    address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT on Solana
    decimals: 6,
    chainId: 101,
    coingeckoId: 'tether',
    binanceSymbol: 'USDT',
  },
];

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId);
}

export function getTokenConfig(symbol: string, chainId: number): TokenConfig | undefined {
  return SUPPORTED_TOKENS.find((token) => token.symbol === symbol && token.chainId === chainId);
}

export function getTokenAddress(symbol: string, chainId: number): string | undefined {
  return getTokenConfig(symbol, chainId)?.address;
}
