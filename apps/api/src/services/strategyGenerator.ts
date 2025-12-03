import OpenAI from 'openai';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { PrismaClient } from '@prisma/client';
import type { StrategyConfig } from '@matcha-ai/shared';
import { backtester } from './backtester';

const prisma = new PrismaClient();

interface GeneratedStrategy {
  name: string;
  description: string;
  chainId: number;
  baseAsset: string;
  universe: string[];
  timeframe: string;
  config: StrategyConfig;
  expectedPerformance?: {
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
}

export class StrategyGenerator {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  /**
   * Generate profitable trading strategies using AI
   * Uses OpenAI to analyze market conditions and create optimized strategies
   */
  async generateStrategies(count: number = 5): Promise<GeneratedStrategy[]> {
    logger.info({ count }, 'Generating AI-powered strategies');

    const strategies: GeneratedStrategy[] = [];

    // Strategy templates for different market conditions and chains
    const strategyTypes = [
      {
        name: 'Momentum Breakout',
        description: 'Captures strong directional moves with high momentum',
        chains: [1, 137, 42161, 101], // Ethereum, Polygon, Arbitrum, Solana
        timeframes: ['5m', '15m', '1h'],
        baseAssets: ['USDC', 'USDT'],
      },
      {
        name: 'Mean Reversion',
        description: 'Profits from price returning to average after overshooting',
        chains: [1, 137, 42161, 101],
        timeframes: ['5m', '15m'],
        baseAssets: ['USDC'],
      },
      {
        name: 'Trend Following',
        description: 'Rides established trends with trailing stops',
        chains: [1, 137, 42161, 101],
        timeframes: ['1h', '4h'],
        baseAssets: ['USDC', 'USDT'],
      },
      {
        name: 'Volatility Breakout',
        description: 'Enters positions when volatility expands',
        chains: [1, 137, 42161, 101],
        timeframes: ['15m', '1h'],
        baseAssets: ['USDC'],
      },
      {
        name: 'Liquidity Scalping',
        description: 'Quick in-and-out trades on high liquidity pairs',
        chains: [1, 137, 42161, 101],
        timeframes: ['1m', '5m'],
        baseAssets: ['USDC', 'USDT'],
      },
    ];

    // Popular trading pairs by chain
    const tradingPairs: Record<number, string[]> = {
      1: ['ETH', 'BTC', 'UNI', 'LINK', 'AAVE'], // Ethereum
      137: ['MATIC', 'ETH', 'USDC', 'WBTC'], // Polygon
      42161: ['ETH', 'ARB', 'USDC', 'GMX'], // Arbitrum
      101: ['SOL', 'USDC', 'BONK', 'RAY', 'JUP'], // Solana
    };

    for (let i = 0; i < count; i++) {
      try {
        const strategyType = strategyTypes[i % strategyTypes.length];
        const chainId = strategyType.chains[i % strategyType.chains.length];
        const timeframe = strategyType.timeframes[i % strategyType.timeframes.length];
        const baseAsset = strategyType.baseAssets[i % strategyType.baseAssets.length];
        const universe = tradingPairs[chainId] || ['ETH'];

        // Use AI to optimize the strategy configuration
        const optimizedConfig = await this.optimizeStrategyWithAI({
          strategyType: strategyType.name,
          chainId,
          timeframe,
          baseAsset,
          universe: universe.slice(0, 3), // Limit to 3 tokens
          description: strategyType.description,
        });

        strategies.push({
          name: `${strategyType.name} - ${chainId === 101 ? 'Solana' : chainId === 1 ? 'Ethereum' : chainId === 137 ? 'Polygon' : 'Arbitrum'}`,
          description: `${strategyType.description}. Optimized for ${chainId === 101 ? 'Solana' : 'EVM'} chain with ${timeframe} timeframe.`,
          chainId,
          baseAsset,
          universe: optimizedConfig.universe || universe.slice(0, 3),
          timeframe,
          config: optimizedConfig,
        });
      } catch (error) {
        logger.error({ error, index: i }, 'Error generating strategy');
      }
    }

    return strategies;
  }

  /**
   * Use OpenAI to optimize strategy configuration based on market research
   */
  private async optimizeStrategyWithAI(params: {
    strategyType: string;
    chainId: number;
    timeframe: string;
    baseAsset: string;
    universe: string[];
    description: string;
  }): Promise<StrategyConfig> {
    const chainName = params.chainId === 101 ? 'Solana' : 
                     params.chainId === 1 ? 'Ethereum' : 
                     params.chainId === 137 ? 'Polygon' : 'Arbitrum';

    const prompt = `You are an expert quantitative trading strategist. Design a profitable ${params.strategyType} trading strategy for ${chainName} blockchain.

Strategy Requirements:
- Chain: ${chainName} (ID: ${params.chainId})
- Timeframe: ${params.timeframe}
- Base Asset: ${params.baseAsset}
- Trading Universe: ${params.universe.join(', ')}
- Strategy Type: ${params.strategyType}
- Description: ${params.description}

Design a strategy configuration that:
1. Maximizes risk-adjusted returns (Sharpe ratio > 1.0)
2. Minimizes drawdown (< 10%)
3. Achieves win rate > 50%
4. Uses appropriate position sizing (Kelly Criterion)
5. Includes proper stop loss and take profit levels
6. Uses relevant technical indicators for the strategy type

For ${params.strategyType}:
${this.getStrategyGuidance(params.strategyType)}

Return ONLY a valid JSON object matching this structure:
{
  "universe": string[],
  "timeframe": "${params.timeframe}",
  "indicators": {
    "rsi": { "period": number, "overbought": number, "oversold": number },
    "ema": { "fast": number, "slow": number },
    "macd": { "fast": number, "slow": number, "signal": number },
    "bollinger": { "period": number, "stdDev": number },
    "atr": { "period": number }
  },
  "riskLimits": {
    "maxPositionPct": number (5-25),
    "maxDailyLossPct": number (2-5),
    "maxLeverage": number (1-3),
    "stopLossPct": number (1-3),
    "takeProfitPct": number (2-6),
    "trailingStopPct": number (0.5-2)
  },
  "thresholds": {
    "minVolume": number (1.0-1.5),
    "minConfidence": number (0.6-0.8),
    "minLiquidity": number
  },
  "entryRules": {
    "momentum": boolean,
    "meanReversion": boolean,
    "breakout": boolean
  },
  "exitRules": {
    "profitTarget": boolean,
    "stopLoss": boolean,
    "trailingStop": boolean,
    "timeBased": boolean
  }
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5.1', // Upgraded from gpt-4
        messages: [
          {
            role: 'system',
            content: 'You are an expert quantitative trading strategist. Always return valid JSON only, no markdown, no explanations.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        reasoning_effort: 'medium', // Adaptive reasoning for strategy optimization
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      // Parse JSON (handle markdown code blocks if present)
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const config = JSON.parse(jsonStr) as StrategyConfig;

      // Validate and set defaults
      return this.validateAndSetDefaults(config, params);
    } catch (error) {
      logger.error({ error, params }, 'Error optimizing strategy with AI, using defaults');
      return this.getDefaultConfig(params);
    }
  }

  private getStrategyGuidance(strategyType: string): string {
    const guidance: Record<string, string> = {
      'Momentum Breakout': `
- Use fast EMAs (9, 21) to catch momentum early
- RSI should be between 50-70 for long entries (not overbought)
- MACD should show bullish crossover
- Volume should be above average (1.2x+)
- Stop loss: 1.5-2%, Take profit: 3-4% (2:1 risk/reward)
- Position size: 10-15% of equity
- Trailing stop: 1% to lock in gains`,

      'Mean Reversion': `
- RSI should be oversold (<30) for longs, overbought (>70) for shorts
- Price should be at Bollinger Band extremes
- ATR should show recent volatility spike
- Entry when price deviates >2% from EMA
- Stop loss: 1-1.5%, Take profit: 1.5-2% (tight)
- Position size: 8-12% of equity
- Quick exits on mean reversion`,

      'Trend Following': `
- Use slow EMAs (21, 50) to identify trends
- MACD should be in trend direction
- Only trade in direction of higher timeframe trend
- Stop loss: 2-3%, Take profit: 4-6% (2:1 risk/reward)
- Position size: 12-18% of equity
- Trailing stop: 1.5% to ride trends`,

      'Volatility Breakout': `
- ATR should be expanding (volatility increasing)
- Bollinger Bands should be widening
- Volume spike on breakout
- Entry on breakout above/below recent range
- Stop loss: 2%, Take profit: 4% (2:1)
- Position size: 10-15% of equity
- Exit quickly if volatility collapses`,

      'Liquidity Scalping': `
- Very fast timeframe (1m, 5m)
- Tight spreads required
- RSI for quick overbought/oversold signals
- Small position sizes (5-10%)
- Very tight stops (0.5-1%)
- Quick profits (1-2%)
- High frequency, small gains`,
    };

    return guidance[strategyType] || '';
  }

  private validateAndSetDefaults(config: StrategyConfig, params: any): StrategyConfig {
    return {
      universe: config.universe || params.universe,
      timeframe: config.timeframe || params.timeframe,
      indicators: {
        rsi: config.indicators?.rsi || { period: 14, overbought: 70, oversold: 30 },
        ema: config.indicators?.ema || { fast: 9, slow: 21 },
        macd: config.indicators?.macd || { fast: 12, slow: 26, signal: 9 },
        bollinger: config.indicators?.bollinger || { period: 20, stdDev: 2 },
        atr: config.indicators?.atr || { period: 14 },
      },
      riskLimits: {
        maxPositionPct: Math.min(25, Math.max(5, config.riskLimits?.maxPositionPct || 15)),
        maxDailyLossPct: Math.min(5, Math.max(2, config.riskLimits?.maxDailyLossPct || 3)),
        maxLeverage: Math.min(3, Math.max(1, config.riskLimits?.maxLeverage || 1)),
        stopLossPct: Math.min(3, Math.max(1, config.riskLimits?.stopLossPct || 2)),
        takeProfitPct: Math.min(6, Math.max(2, config.riskLimits?.takeProfitPct || 4)),
        trailingStopPct: config.riskLimits?.trailingStopPct || 1.5,
      },
      thresholds: {
        minVolume: config.thresholds?.minVolume || 1.1,
        minConfidence: Math.min(0.8, Math.max(0.6, config.thresholds?.minConfidence || 0.65)),
        minLiquidity: config.thresholds?.minLiquidity || 10000,
      },
      entryRules: config.entryRules || {
        momentum: true,
        meanReversion: false,
        breakout: false,
      },
      exitRules: config.exitRules || {
        profitTarget: true,
        stopLoss: true,
        trailingStop: true,
        timeBased: false,
      },
    };
  }

  private getDefaultConfig(params: any): StrategyConfig {
    return {
      universe: params.universe,
      timeframe: params.timeframe,
      indicators: {
        rsi: { period: 14, overbought: 70, oversold: 30 },
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
        breakout: false,
      },
      exitRules: {
        profitTarget: true,
        stopLoss: true,
        trailingStop: true,
        timeBased: false,
      },
    };
  }

  /**
   * Create strategies in the database and optionally backtest them
   */
  async createStrategiesInDatabase(
    strategies: GeneratedStrategy[],
    userId: string,
    backtest: boolean = true
  ): Promise<string[]> {
    const strategyIds: string[] = [];

    for (const strategy of strategies) {
      try {
        // Create strategy in database
        const created = await prisma.strategy.create({
          data: {
            userId,
            name: strategy.name,
            description: strategy.description,
            mode: 'PAPER', // Start in paper trading mode
            baseAsset: strategy.baseAsset,
            universeJson: JSON.stringify(strategy.universe),
            timeframe: strategy.timeframe,
            chainId: strategy.chainId,
            configJson: JSON.stringify(strategy.config),
            status: 'PAUSED', // Start paused, user can activate
          },
        });

        strategyIds.push(created.id);

        // Optionally run a quick backtest to validate
        if (backtest) {
          try {
            const backtestResult = await backtester.runBacktest({
              strategyId: created.id,
              from: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days
              to: Date.now(),
              initialEquity: 10000,
            });

            logger.info(
              {
                strategyId: created.id,
                name: strategy.name,
                totalReturn: backtestResult.metrics.totalReturnPct,
                winRate: backtestResult.metrics.winRate,
                trades: backtestResult.metrics.totalTrades,
              },
              'Strategy backtested successfully'
            );
          } catch (error) {
            logger.warn({ error, strategyId: created.id }, 'Backtest failed, but strategy created');
          }
        }

        logger.info({ strategyId: created.id, name: strategy.name }, 'Strategy created');
      } catch (error) {
        logger.error({ error, strategy }, 'Error creating strategy in database');
      }
    }

    return strategyIds;
  }
}

export const strategyGenerator = new StrategyGenerator();


