export type StrategyMode = 'SIMULATION' | 'PAPER' | 'LIVE';
export type StrategyStatus = 'ACTIVE' | 'PAUSED';
export type TradeMode = 'BACKTEST' | 'PAPER' | 'LIVE';
export type TradeSide = 'BUY' | 'SELL';
export type ConfigSuggestionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  unrealizedPnl: number;
}

export interface PerformanceMetrics {
  realizedPnl: number;
  maxDrawdown: number;
  winRate: number;
  sharpe?: number;
  totalTrades?: number;
  winningTrades?: number;
  losingTrades?: number;
}

export interface RiskLimits {
  maxPositionPct: number; // 0-100
  maxDailyLossPct: number; // 0-100
  maxLeverage?: number;
  maxDrawdownPct?: number;
  maxPortfolioVaRPct?: number;
  varConfidence?: number; // 0-1
  kellyFractionCapPct?: number;
  circuitBreakerPct?: number;
  stopLossPct?: number; // Stop loss percentage (e.g., 2 = 2% loss)
  takeProfitPct?: number; // Take profit percentage (e.g., 5 = 5% gain)
  trailingStopPct?: number; // Trailing stop percentage
  trailingStopActivationPct?: number; // Activation threshold for trailing stop
}

export interface MarketContext {
  recentCandles: Candle[];
  indicators: Record<string, number>; // e.g. rsi, emaTrend, volatility
  openPositions: Position[];
  performance: PerformanceMetrics;
  riskLimits: RiskLimits;
  currentEquity: number;
  dailyPnl: number;
}

export interface Decision {
  action: 'long' | 'short' | 'flat';
  confidence: number; // 0–1
  targetPositionSizePct: number; // 0–100
  notes: string;
}

export interface StrategyConfig {
  baseAsset: string;
  universe: string[]; // token symbols
  timeframe: string; // "1m", "5m", "1h", "1d"
  riskLimits: RiskLimits;
  indicators?: {
    rsi?: { period: number; overbought: number; oversold: number };
    ema?: { fast: number; slow: number };
    volatility?: { period: number };
  };
  thresholds?: {
    minConfidence?: number;
    minVolume?: number;
  };
  ai?: {
    mode: 'OFF' | 'ASSIST' | 'FULL';
    model?: 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5.1';
    confidenceThreshold?: number; // Only use AI if fast decision confidence < this
    minTradesForAI?: number; // Only use AI after N trades
  };
}

export interface Trade {
  id?: string;
  strategyId: string;
  timestamp: number;
  mode: TradeMode;
  symbol: string;
  side: TradeSide;
  size: number;
  entryPrice: number;
  exitPrice?: number;
  fees: number;
  slippage: number;
  pnl: number;
  pnlPct: number;
  txHash?: string;
}

export interface ZeroXQuoteParams {
  chainId: number;
  sellToken: string; // token address
  buyToken: string; // token address
  amount: string; // sell amount in wei/smallest unit
  slippageBps?: number; // basis points, e.g. 50 = 0.5%
}

export interface ZeroXQuote {
  price: string;
  guaranteedPrice: string;
  estimatedPriceImpact: string;
  buyAmount: string;
  sellAmount: string;
  allowanceTarget?: string;
  to: string;
  data: string;
  value: string;
  gas?: string;
  gasPrice?: string;
  // Gasless API fields
  metaTransaction?: {
    to: string;
    data: string;
    value: string;
  };
}

export interface ZeroXSwapTx {
  to: string;
  data: string;
  value: string;
  gas?: string;
  gasPrice?: string;
  chainId: number;
  allowanceTarget?: string; // AllowanceHolder or Permit2 address
}

export interface GaslessQuoteParams extends ZeroXQuoteParams {
  takerAddress: string; // Required for gasless quotes
  enableGasless?: boolean;
}

export type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REVERTED';

export interface ExecutionQuality {
  expectedPrice: string;
  actualPrice: string;
  slippageBps: number; // Actual slippage in basis points
  fillRate: number; // 0-1, percentage of order filled
  executionTimeMs: number; // Time from submission to confirmation
  gasUsed?: string;
  gasPrice?: string;
  priceImpact?: string;
}

export interface TradeAnalytics {
  tradeId: string;
  strategyId: string;
  executionQuality: ExecutionQuality;
  timestamp: number;
  chainId: number;
  txHash: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  zeroXApiUrl: string;
}

export interface TokenConfig {
  symbol: string;
  address: string;
  decimals: number;
  chainId: number;
  coingeckoId?: string;
  binanceSymbol?: string; // Symbol used by Binance (e.g., ETH for WETH)
}
