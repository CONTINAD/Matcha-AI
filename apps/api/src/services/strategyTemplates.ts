import type { StrategyConfig } from '@matcha-ai/shared';

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  config: StrategyConfig;
  category: 'momentum' | 'mean-reversion' | 'breakout' | 'trend-following';
}

/**
 * Built-in strategy templates for EVM spot trading
 */
export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 'momentum-ema',
    name: 'Momentum (EMA Crossover)',
    description: 'EMA crossover with RSI and volume filters. Best in trending markets.',
    category: 'momentum',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '1h',
      riskLimits: {
        maxPositionPct: 15,
        maxDailyLossPct: 3,
        stopLossPct: 2,
        takeProfitPct: 4,
        trailingStopPct: 1.5,
      },
      indicators: {
        ema: { fast: 12, slow: 26 },
        rsi: { period: 14, overbought: 70, oversold: 30 },
      },
      thresholds: {
        minVolume: 1.2, // 20% above average
      },
    },
  },
  {
    id: 'mean-reversion-rsi',
    name: 'Mean Reversion (RSI + Bollinger)',
    description: 'Buy oversold, sell overbought. Works best in ranging markets.',
    category: 'mean-reversion',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '1h',
      riskLimits: {
        maxPositionPct: 10,
        maxDailyLossPct: 2,
        stopLossPct: 1.5,
        takeProfitPct: 3,
      },
      indicators: {
        rsi: { period: 14, overbought: 75, oversold: 25 },
      },
    },
  },
  {
    id: 'breakout-atr',
    name: 'Breakout (ATR Range)',
    description: 'Trade breakouts from consolidation ranges using ATR.',
    category: 'breakout',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '1h',
      riskLimits: {
        maxPositionPct: 12,
        maxDailyLossPct: 3,
        stopLossPct: 2.5,
        takeProfitPct: 5,
      },
      indicators: {
        volatility: { period: 14 }, // ATR
      },
      thresholds: {
        minVolume: 1.0,
      },
    },
  },
  {
    id: 'trend-following-multi',
    name: 'Trend Following (Multi-Timeframe)',
    description: 'Multi-timeframe EMA alignment for strong trends.',
    category: 'trend-following',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '1h',
      riskLimits: {
        maxPositionPct: 20,
        maxDailyLossPct: 4,
        stopLossPct: 3,
        takeProfitPct: 6,
        trailingStopPct: 2,
      },
      indicators: {
        ema: { fast: 9, slow: 50 },
      },
    },
  },
  {
    id: 'solana-optimized',
    name: 'Solana Optimized (SOL/USDC)',
    description: 'Perfect for Solana private key trading. Optimized for low fees, fast execution, and SOL/USDC pair. Designed for small accounts ($5+).',
    category: 'momentum',
    config: {
      baseAsset: 'USDC',
      universe: ['SOL'],
      timeframe: '5m', // Faster timeframe for Solana's speed
      riskLimits: {
        maxPositionPct: 15, // Conservative for small accounts
        maxDailyLossPct: 3, // Tight risk control
        stopLossPct: 1.5, // Tighter stops for volatility
        takeProfitPct: 3, // Quick profits
        trailingStopPct: 1, // Lock in gains
      },
      indicators: {
        ema: { fast: 9, slow: 21 }, // Faster for 5m timeframe
        rsi: { period: 14, overbought: 70, oversold: 30 },
      },
      thresholds: {
        minVolume: 1.1, // Lower threshold for Solana
        minConfidence: 0.65, // Higher confidence needed
      },
    },
  },
];

/**
 * Get template by ID
 */
export function getTemplate(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.id === id);
}

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: StrategyTemplate['category']): StrategyTemplate[] {
  return STRATEGY_TEMPLATES.filter((t) => t.category === category);
}

