import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { solanaLogger } from './solanaLogger';
import type { StrategyConfig } from '@matcha-ai/shared';

const prisma = new PrismaClient();

/**
 * Research-Based Solana Strategy Generator
 * Based on proven Solana trading strategies:
 * 1. Cross-DEX Arbitrage (Jupiter routing)
 * 2. JIT Liquidity Provision
 * 3. Momentum Breakout (fast execution)
 * 4. RSI Mean Reversion (volatile markets)
 * 5. MACD Trend Following
 * 6. Small Account Optimized (low fees, fast execution)
 */

interface SolanaStrategyTemplate {
  name: string;
  description: string;
  timeframe: string;
  universe: string[];
  indicators: any;
  riskLimits: any;
  thresholds: any;
  entryRules: any;
  exitRules: any;
  solanaOptimizations: {
    useJupiterRouting: boolean;
    prioritizeSpeed: boolean;
    minLiquidity: number;
    maxSlippage: number;
  };
}

const SOLANA_STRATEGY_TEMPLATES: SolanaStrategyTemplate[] = [
  {
    name: 'Solana Cross-DEX Arbitrage',
    description: 'Capitalizes on price discrepancies across Solana DEXs using Jupiter routing. Optimized for fast execution and low fees.',
    timeframe: '1m', // Fast timeframe for arbitrage
    universe: ['SOL', 'USDC'],
    indicators: {
      rsi: { period: 14, overbought: 70, oversold: 30 },
      ema: { fast: 5, slow: 15 }, // Faster EMAs for quick signals
      macd: { fast: 8, slow: 17, signal: 9 },
      bollinger: { period: 10, stdDev: 2 }, // Shorter period for volatility
      atr: { period: 10 },
    },
    riskLimits: {
      maxPositionPct: 20, // Higher for arbitrage (lower risk)
      maxDailyLossPct: 2, // Conservative for small account
      maxLeverage: 1,
      stopLossPct: 1, // Tight stop for arbitrage
      takeProfitPct: 0.5, // Quick profits
      trailingStopPct: 0.3,
    },
    thresholds: {
      minVolume: 1.0, // Lower threshold for Solana
      minConfidence: 0.7, // Higher confidence for arbitrage
      minLiquidity: 5000, // Lower for Solana
    },
    entryRules: {
      momentum: true,
      meanReversion: false,
      breakout: true,
      arbitrage: true, // Solana-specific
    },
    exitRules: {
      profitTarget: true,
      stopLoss: true,
      trailingStop: true,
      timeBased: true, // Exit quickly
    },
    solanaOptimizations: {
      useJupiterRouting: true,
      prioritizeSpeed: true,
      minLiquidity: 5000,
      maxSlippage: 0.5, // 0.5% max slippage
    },
  },
  {
    name: 'Solana Momentum Breakout',
    description: 'Captures strong directional moves on Solana. Optimized for fast execution and trending markets.',
    timeframe: '5m', // Good balance for momentum
    universe: ['SOL', 'USDC', 'BONK', 'RAY'],
    indicators: {
      rsi: { period: 14, overbought: 75, oversold: 25 },
      ema: { fast: 9, slow: 21 },
      macd: { fast: 12, slow: 26, signal: 9 },
      bollinger: { period: 20, stdDev: 2 },
      atr: { period: 14 },
    },
    riskLimits: {
      maxPositionPct: 15,
      maxDailyLossPct: 3,
      maxLeverage: 1,
      stopLossPct: 2,
      takeProfitPct: 4,
      trailingStopPct: 1.5,
    },
    thresholds: {
      minVolume: 1.1,
      minConfidence: 0.65,
      minLiquidity: 10000,
    },
    entryRules: {
      momentum: true,
      meanReversion: false,
      breakout: true,
    },
    exitRules: {
      profitTarget: true,
      stopLoss: true,
      trailingStop: true,
      timeBased: false,
    },
    solanaOptimizations: {
      useJupiterRouting: true,
      prioritizeSpeed: true,
      minLiquidity: 10000,
      maxSlippage: 1.0,
    },
  },
  {
    name: 'Solana RSI Mean Reversion',
    description: 'Profits from price reversals in volatile Solana markets. Perfect for small accounts with quick in-out trades.',
    timeframe: '5m',
    universe: ['SOL', 'USDC'],
    indicators: {
      rsi: { period: 14, overbought: 70, oversold: 30 },
      ema: { fast: 9, slow: 21 },
      macd: { fast: 12, slow: 26, signal: 9 },
      bollinger: { period: 20, stdDev: 2 },
      atr: { period: 14 },
    },
    riskLimits: {
      maxPositionPct: 12, // Smaller for mean reversion
      maxDailyLossPct: 2.5,
      maxLeverage: 1,
      stopLossPct: 1.5,
      takeProfitPct: 3,
      trailingStopPct: 1.0,
    },
    thresholds: {
      minVolume: 1.0,
      minConfidence: 0.6,
      minLiquidity: 8000,
    },
    entryRules: {
      momentum: false,
      meanReversion: true, // Key for this strategy
      breakout: false,
    },
    exitRules: {
      profitTarget: true,
      stopLoss: true,
      trailingStop: true,
      timeBased: true,
    },
    solanaOptimizations: {
      useJupiterRouting: true,
      prioritizeSpeed: true,
      minLiquidity: 8000,
      maxSlippage: 0.8,
    },
  },
];

export class SolanaStrategyGenerator {
  /**
   * Generate research-based Solana strategies
   */
  async generateSolanaStrategies(count: number = 5): Promise<string[]> {
    const strategyIds: string[] = [];
    const templates = SOLANA_STRATEGY_TEMPLATES.slice(0, count);

    solanaLogger.logger.info({ count: templates.length }, 'Generating research-based Solana strategies');

    for (const template of templates) {
      try {
        const strategy = await prisma.strategy.create({
          data: {
            userId: 'a11393e6-100f-463d-b294-fbe2687e0c75', // Default user
            name: template.name,
            description: template.description,
            mode: 'PAPER', // Start in paper mode
            baseAsset: 'USDC',
            universeJson: JSON.stringify(template.universe),
            timeframe: template.timeframe,
            status: 'PAUSED',
            chainId: 101, // Solana
            configJson: JSON.stringify({
              universe: template.universe,
              timeframe: template.timeframe,
              indicators: template.indicators,
              riskLimits: template.riskLimits,
              thresholds: template.thresholds,
              entryRules: template.entryRules,
              exitRules: template.exitRules,
              solanaOptimizations: template.solanaOptimizations,
            } as StrategyConfig),
          },
        });

        strategyIds.push(strategy.id);
        solanaLogger.logger.info(
          { strategyId: strategy.id, name: template.name },
          `✅ Created Solana strategy: ${template.name}`
        );
      } catch (error: any) {
        logger.error({ error: error.message, template: template.name }, 'Failed to create Solana strategy');
        solanaLogger.error(null, error, { template: template.name });
      }
    }

    return strategyIds;
  }

  /**
   * Get strategy template by name
   */
  getTemplate(name: string): SolanaStrategyTemplate | undefined {
    return SOLANA_STRATEGY_TEMPLATES.find((t) => t.name === name);
  }

  /**
   * Get all templates
   */
  getAllTemplates(): SolanaStrategyTemplate[] {
    return SOLANA_STRATEGY_TEMPLATES;
  }
}

export const solanaStrategyGenerator = new SolanaStrategyGenerator();


