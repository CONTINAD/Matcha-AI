import type { Candle, Indicators, Decision, StrategyConfig } from '@matcha-ai/shared';
import { detectTrendRegime, detectVolatilityRegime } from './features';
import { trendFollowingStrategy } from './strategies/trendFollowing';
import { momentumStrategy } from './strategies/momentum';
import { breakoutStrategy } from './strategies/breakout';
import { gridTradingStrategy } from './strategies/gridTrading';
import { strategyEngine } from './strategyEngine';
import { logger } from '../config/logger';
import { strategySwitches, strategyPerformance } from './metrics';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type StrategyType = 'trend-following' | 'momentum' | 'breakout' | 'grid' | 'mean-reversion' | 'arbitrage';

export interface StrategyPerformance {
  strategyType: StrategyType;
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
  avgReturn: number;
  lastUsed?: number; // timestamp
}

/**
 * Strategy Selector
 * 
 * Dynamically switches strategies based on:
 * - Market regime (trending → trend-following, ranging → mean reversion/grid)
 * - Recent performance (if strategy losing, switch)
 * - Time of day (some strategies work better at certain times)
 */
export class StrategySelector {
  private strategyPerformance: Map<string, Map<StrategyType, StrategyPerformance>> = new Map(); // strategyId -> strategy type -> performance

  /**
   * Select best strategy for current market conditions
   */
  async selectStrategy(
    strategyId: string,
    candles: Candle[],
    indicators: Indicators,
    strategyConfig: StrategyConfig
  ): Promise<StrategyType | null> {
    // 1. Detect current market regime
    const trendRegime = detectTrendRegime(candles, indicators);
    const volRegime = detectVolatilityRegime(candles, indicators);

    // 2. Get historical performance for this strategy
    const performance = await this.getStrategyPerformance(strategyId);

    // 3. Select strategy based on regime
    let recommendedStrategy: StrategyType | null = null;

    if (trendRegime === 'trending' && volRegime !== 'high') {
      // Trending market: Use trend-following or momentum
      const trendPerf = performance.get('trend-following');
      const momentumPerf = performance.get('momentum');

      if (trendPerf && momentumPerf) {
        // Choose based on performance
        recommendedStrategy = trendPerf.sharpeRatio > momentumPerf.sharpeRatio ? 'trend-following' : 'momentum';
      } else if (trendPerf) {
        recommendedStrategy = 'trend-following';
      } else if (momentumPerf) {
        recommendedStrategy = 'momentum';
      } else {
        recommendedStrategy = 'trend-following'; // Default for trending
      }
    } else if (trendRegime === 'ranging') {
      // Ranging market: Use mean reversion or grid trading
      const meanRevPerf = performance.get('mean-reversion');
      const gridPerf = performance.get('grid');

      if (meanRevPerf && gridPerf) {
        recommendedStrategy = meanRevPerf.sharpeRatio > gridPerf.sharpeRatio ? 'mean-reversion' : 'grid';
      } else if (meanRevPerf) {
        recommendedStrategy = 'mean-reversion';
      } else if (gridPerf) {
        recommendedStrategy = 'grid';
      } else {
        recommendedStrategy = 'mean-reversion'; // Default for ranging
      }
    } else if (trendRegime === 'choppy' || volRegime === 'high') {
      // Choppy/high volatility: Use arbitrage or stay flat
      const arbPerf = performance.get('arbitrage');
      if (arbPerf && arbPerf.sharpeRatio > 1.0) {
        recommendedStrategy = 'arbitrage';
      } else {
        // No good strategy for choppy markets, return null (stay flat)
        return null;
      }
    }

    // 4. Check if recommended strategy is underperforming
    if (recommendedStrategy) {
      const perf = performance.get(recommendedStrategy);
      if (perf && perf.totalTrades >= 10) {
        // If strategy has low Sharpe or negative returns, try alternative
        if (perf.sharpeRatio < 0.5 || perf.avgReturn < 0) {
          logger.warn(
            {
              strategyId,
              recommendedStrategy,
              sharpeRatio: perf.sharpeRatio,
              avgReturn: perf.avgReturn,
            },
            'Recommended strategy underperforming, considering alternatives'
          );

          // Try alternative strategies
          const alternatives = this.getAlternativeStrategies(recommendedStrategy, trendRegime);
          for (const alt of alternatives) {
            const altPerf = performance.get(alt);
            if (altPerf && altPerf.sharpeRatio > perf.sharpeRatio) {
              recommendedStrategy = alt;
              // Record strategy switch metric
              strategySwitches.inc({
                from_strategy: recommendedStrategy,
                to_strategy: alt,
                regime: trendRegime,
              });
              
              logger.info(
                {
                  strategyId,
                  original: recommendedStrategy,
                  switchedTo: alt,
                  reason: 'better performance',
                  trendRegime,
                  volRegime,
                },
                'Switched to alternative strategy'
              );
              break;
            }
          }
        }
      }
    }

    // 5. Time-based adjustment (some strategies work better at certain times)
    const hour = new Date().getUTCHours();
    if (recommendedStrategy === 'arbitrage' && (hour >= 0 && hour < 6)) {
      // Arbitrage less effective during low liquidity hours
      logger.debug({ hour, strategyId }, 'Arbitrage less effective during low liquidity, considering alternatives');
      const alternatives = this.getAlternativeStrategies('arbitrage', trendRegime);
      if (alternatives.length > 0) {
        recommendedStrategy = alternatives[0];
      }
    }

    logger.info(
      {
        strategyId,
        recommendedStrategy,
        trendRegime,
        volRegime,
        hour,
      },
      'Strategy selected based on market regime'
    );

    return recommendedStrategy;
  }

  /**
   * Get alternative strategies for a given strategy type
   */
  private getAlternativeStrategies(strategyType: StrategyType, trendRegime: string): StrategyType[] {
    const alternatives: StrategyType[] = [];

    switch (strategyType) {
      case 'trend-following':
        alternatives.push('momentum', 'breakout');
        break;
      case 'momentum':
        alternatives.push('trend-following', 'breakout');
        break;
      case 'breakout':
        alternatives.push('trend-following', 'momentum');
        break;
      case 'mean-reversion':
        alternatives.push('grid');
        break;
      case 'grid':
        alternatives.push('mean-reversion');
        break;
      case 'arbitrage':
        if (trendRegime === 'trending') {
          alternatives.push('trend-following', 'momentum');
        } else if (trendRegime === 'ranging') {
          alternatives.push('mean-reversion', 'grid');
        }
        break;
    }

    return alternatives;
  }

  /**
   * Get strategy performance from database
   */
  private async getStrategyPerformance(strategyId: string): Promise<Map<StrategyType, StrategyPerformance>> {
    // Check cache first
    if (this.strategyPerformance.has(strategyId)) {
      return this.strategyPerformance.get(strategyId)!;
    }

    const performance = new Map<StrategyType, StrategyPerformance>();

    try {
      // Get recent trades for this strategy
      const recentTrades = await prisma.trade.findMany({
        where: {
          strategyId,
          timestamp: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });

      // Group trades by strategy type (would need to store strategy type in trade metadata)
      // For now, we'll use a simplified approach: analyze all trades together
      // In a full implementation, we'd track which strategy generated each trade

      // Calculate overall performance
      const closedTrades = recentTrades.filter((t) => t.exitPrice);
      if (closedTrades.length > 0) {
        const wins = closedTrades.filter((t) => t.pnl > 0).length;
        const winRate = wins / closedTrades.length;
        const avgReturn = closedTrades.reduce((sum, t) => sum + (t.pnlPct || 0), 0) / closedTrades.length;
        
        // Simplified Sharpe calculation (would need returns array for full calculation)
        const sharpeRatio = winRate > 0.5 ? 1.5 : 0.5; // Placeholder

        // For now, we'll assume all strategies have similar performance
        // In a full implementation, we'd track performance per strategy type
        performance.set('trend-following', {
          strategyType: 'trend-following',
          winRate,
          sharpeRatio,
          totalTrades: closedTrades.length,
          avgReturn,
        });
        performance.set('momentum', {
          strategyType: 'momentum',
          winRate,
          sharpeRatio,
          totalTrades: closedTrades.length,
          avgReturn,
        });
        performance.set('mean-reversion', {
          strategyType: 'mean-reversion',
          winRate,
          sharpeRatio,
          totalTrades: closedTrades.length,
          avgReturn,
        });
      }
    } catch (error) {
      logger.error({ error, strategyId }, 'Error fetching strategy performance');
    }

    // Cache performance
    this.strategyPerformance.set(strategyId, performance);

    return performance;
  }

  /**
   * Update strategy performance after a trade
   */
  async updatePerformance(
    strategyId: string,
    strategyType: StrategyType,
    tradeResult: { pnl: number; pnlPct: number; win: boolean }
  ): Promise<void> {
    const performance = await this.getStrategyPerformance(strategyId);
    const current = performance.get(strategyType);

    if (current) {
      // Update performance metrics
      const newTotalTrades = current.totalTrades + 1;
      const newWins = current.winRate * current.totalTrades + (tradeResult.win ? 1 : 0);
      const newWinRate = newWins / newTotalTrades;
      const newAvgReturn = (current.avgReturn * current.totalTrades + tradeResult.pnlPct) / newTotalTrades;

      const updated = {
        ...current,
        winRate: newWinRate,
        totalTrades: newTotalTrades,
        avgReturn: newAvgReturn,
        lastUsed: Date.now(),
      };
      
      performance.set(strategyType, updated);
      
      // Update metrics
      strategyPerformance.set({ strategy_type: strategyType, metric: 'win_rate' }, newWinRate);
      strategyPerformance.set({ strategy_type: strategyType, metric: 'avg_return' }, newAvgReturn);
    } else {
      // Create new performance record
      performance.set(strategyType, {
        strategyType,
        winRate: tradeResult.win ? 1 : 0,
        sharpeRatio: 0.5, // Initial value
        totalTrades: 1,
        avgReturn: tradeResult.pnlPct,
        lastUsed: Date.now(),
      });
    }

    // Update cache
    this.strategyPerformance.set(strategyId, performance);
  }

  /**
   * Generate decision using selected strategy
   */
  async generateDecision(
    strategyId: string,
    candles: Candle[],
    indicators: Indicators,
    strategyConfig: StrategyConfig
  ): Promise<Decision | null> {
    const selectedStrategy = await this.selectStrategy(strategyId, candles, indicators, strategyConfig);

    if (!selectedStrategy) {
      return null; // No strategy suitable for current conditions
    }

    // Generate decision using selected strategy
    switch (selectedStrategy) {
      case 'trend-following':
        return trendFollowingStrategy.generateDecision(candles, indicators);
      case 'momentum':
        return momentumStrategy.generateDecision(candles, indicators);
      case 'breakout':
        return breakoutStrategy.generateDecision(candles, indicators);
      case 'grid':
        return gridTradingStrategy.generateDecision(candles, indicators, 0, []);
      case 'mean-reversion':
        // Use existing mean reversion from strategyEngine
        const meanRev = await strategyEngine.meanReversionSignal(
          strategyConfig.baseAsset === 'USDC' ? 137 : 1, // Default to Polygon
          strategyConfig.baseAsset,
          strategyConfig.universe[0] || 'WETH',
          30
        );
        if (meanRev.action !== 'hold') {
          return {
            action: meanRev.action === 'buy' ? 'long' : meanRev.action === 'sell' ? 'short' : 'flat',
            confidence: 0.6,
            targetPositionSizePct: 5,
            notes: `Mean reversion: ${meanRev.action} signal, deviation=${meanRev.deviation.toFixed(2)}`,
          };
        }
        return null;
      case 'arbitrage':
        // Use existing arbitrage from strategyEngine
        const arb = await strategyEngine.detectArb(
          strategyConfig.baseAsset === 'USDC' ? 137 : 1,
          strategyConfig.baseAsset,
          strategyConfig.universe,
          2.0
        );
        if (arb) {
          return {
            action: 'long', // Arbitrage is always long one asset, short another
            confidence: 0.8,
            targetPositionSizePct: 10,
            notes: `Arbitrage: ${arb.edge.toFixed(2)}% edge detected`,
          };
        }
        return null;
      default:
        return null;
    }
  }
}

export const strategySelector = new StrategySelector();

