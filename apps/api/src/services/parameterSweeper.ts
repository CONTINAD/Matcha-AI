import type { StrategyConfig, RiskLimits } from '@matcha-ai/shared';
import { backtester } from './backtester';
import { dataFeed } from './dataFeed';
import { logger } from '../config/logger';

export interface ParameterSweepConfig {
  symbol: string;
  baseAsset: string;
  timeframe: string;
  chainId: number;
  from: number; // timestamp
  to: number; // timestamp
  initialEquity: number;
  
  // Parameter ranges to sweep
  rsiOversoldRange?: { min: number; max: number; step: number }; // e.g., { min: 20, max: 35, step: 5 }
  rsiOverboughtRange?: { min: number; max: number; step: number }; // e.g., { min: 65, max: 80, step: 5 }
  adxThresholdRange?: { min: number; max: number; step: number }; // e.g., { min: 15, max: 30, step: 5 }
  positionSizeRange?: { min: number; max: number; step: number }; // e.g., { min: 3, max: 10, step: 1 }
  stopLossRange?: { min: number; max: number; step: number }; // e.g., { min: 1, max: 3, step: 0.5 }
  takeProfitRange?: { min: number; max: number; step: number }; // e.g., { min: 2, max: 5, step: 1 }
}

export interface SweepResult {
  config: StrategyConfig;
  result: {
    totalReturn: number;
    totalReturnPct: number;
    maxDrawdown: number;
    winRate: number;
    sharpe?: number;
    totalTrades: number;
  };
  params: {
    rsiOversold?: number;
    rsiOverbought?: number;
    adxThreshold?: number;
    positionSize?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
}

/**
 * Parameter Sweeper
 * 
 * Sweeps through parameter combinations to find optimal configurations
 * for a given symbol/timeframe.
 */
export class ParameterSweeper {
  /**
   * Run parameter sweep
   */
  async sweep(params: ParameterSweepConfig): Promise<SweepResult[]> {
    logger.info({ params }, 'Starting parameter sweep');

    // Get historical candles
    const candles = await dataFeed.getHistoricalCandles({
      symbol: params.symbol,
      timeframe: params.timeframe,
      from: params.from,
      to: params.to,
      chainId: params.chainId,
      baseAsset: params.baseAsset,
      useCache: true,
    });

    if (candles.length < 50) {
      throw new Error(`Not enough candles: ${candles.length} (need at least 50)`);
    }

    const results: SweepResult[] = [];

    // Generate parameter combinations
    const combinations = this.generateCombinations(params);

    logger.info({ totalCombinations: combinations.length }, 'Generated parameter combinations');

    // Run backtest for each combination
    for (let i = 0; i < combinations.length; i++) {
      const combo = combinations[i];
      try {
        logger.info({ i: i + 1, total: combinations.length, combo }, 'Running backtest');

        const strategyConfig: StrategyConfig = {
          baseAsset: params.baseAsset,
          universe: [params.symbol],
          timeframe: params.timeframe,
          riskLimits: {
            maxPositionPct: combo.positionSize || 5,
            maxDailyLossPct: 5,
            stopLossPct: combo.stopLoss || 2,
            takeProfitPct: combo.takeProfit || 4,
          },
          indicators: {
            rsi: {
              period: 14,
              overbought: combo.rsiOverbought || 70,
              oversold: combo.rsiOversold || 30,
            },
            ema: {
              fast: 9,
              slow: 21,
            },
          },
        };

        const backtestResult = await backtester.runBacktest({
          strategyConfig,
          candles,
          initialEquity: params.initialEquity,
          fastMode: true, // Use fast mode for speed
        });

        results.push({
          config: strategyConfig,
          result: {
            totalReturn: backtestResult.totalReturn,
            totalReturnPct: backtestResult.totalReturnPct,
            maxDrawdown: backtestResult.performance.maxDrawdown,
            winRate: backtestResult.performance.winRate,
            sharpe: backtestResult.performance.sharpe,
            totalTrades: backtestResult.trades.length,
          },
          params: combo,
        });
      } catch (error: any) {
        logger.warn({ error: error.message, combo }, 'Backtest failed for combination');
      }
    }

    // Sort by Sharpe ratio (or total return if Sharpe is undefined)
    results.sort((a, b) => {
      const aScore = a.result.sharpe ?? a.result.totalReturnPct;
      const bScore = b.result.sharpe ?? b.result.totalReturnPct;
      return bScore - aScore;
    });

    logger.info({ topResults: results.slice(0, 10).map(r => ({ return: r.result.totalReturnPct, sharpe: r.result.sharpe, trades: r.result.totalTrades })) }, 'Parameter sweep completed');

    return results;
  }

  /**
   * Generate all parameter combinations
   */
  private generateCombinations(params: ParameterSweepConfig): Array<{
    rsiOversold?: number;
    rsiOverbought?: number;
    adxThreshold?: number;
    positionSize?: number;
    stopLoss?: number;
    takeProfit?: number;
  }> {
    const combinations: Array<{
      rsiOversold?: number;
      rsiOverbought?: number;
      adxThreshold?: number;
      positionSize?: number;
      stopLoss?: number;
      takeProfit?: number;
    }> = [];

    // Default ranges if not specified
    const rsiOversoldRange = params.rsiOversoldRange || { min: 25, max: 35, step: 5 };
    const rsiOverboughtRange = params.rsiOverboughtRange || { min: 65, max: 75, step: 5 };
    const adxThresholdRange = params.adxThresholdRange || { min: 20, max: 30, step: 5 };
    const positionSizeRange = params.positionSizeRange || { min: 3, max: 8, step: 1 };
    const stopLossRange = params.stopLossRange || { min: 1.5, max: 2.5, step: 0.5 };
    const takeProfitRange = params.takeProfitRange || { min: 3, max: 5, step: 1 };

    // Generate all combinations
    for (let rsiOversold = rsiOversoldRange.min; rsiOversold <= rsiOversoldRange.max; rsiOversold += rsiOversoldRange.step) {
      for (let rsiOverbought = rsiOverboughtRange.min; rsiOverbought <= rsiOverboughtRange.max; rsiOverbought += rsiOverboughtRange.step) {
        for (let adxThreshold = adxThresholdRange.min; adxThreshold <= adxThresholdRange.max; adxThreshold += adxThresholdRange.step) {
          for (let positionSize = positionSizeRange.min; positionSize <= positionSizeRange.max; positionSize += positionSizeRange.step) {
            for (let stopLoss = stopLossRange.min; stopLoss <= stopLossRange.max; stopLoss += stopLossRange.step) {
              for (let takeProfit = takeProfitRange.min; takeProfit <= takeProfitRange.max; takeProfit += takeProfitRange.step) {
                combinations.push({
                  rsiOversold,
                  rsiOverbought,
                  adxThreshold,
                  positionSize,
                  stopLoss,
                  takeProfit,
                });
              }
            }
          }
        }
      }
    }

    return combinations;
  }

  /**
   * Get top N configurations by Sharpe ratio
   */
  getTopConfigs(results: SweepResult[], n: number = 10): SweepResult[] {
    return results
      .filter(r => r.result.totalTrades >= 5) // At least 5 trades
      .filter(r => r.result.maxDrawdown < 20) // Max drawdown < 20%
      .filter(r => r.result.winRate > 0.4) // Win rate > 40%
      .slice(0, n);
  }
}

export const parameterSweeper = new ParameterSweeper();

