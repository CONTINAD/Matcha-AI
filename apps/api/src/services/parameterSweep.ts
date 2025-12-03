import { Backtester } from './backtester';
import { getTemplate, type StrategyTemplate } from './strategyTemplates';
import { logger } from '../config/logger';
import type { StrategyConfig, Candle } from '@matcha-ai/shared';

export interface SweepResult {
  config: StrategyConfig;
  metrics: {
    totalReturn: number;
    totalReturnPct: number;
    maxDrawdown: number;
    winRate: number;
    sharpeRatio: number;
    totalTrades: number;
    totalFees: number;
  };
  templateId: string;
  variantName: string;
}

export interface SweepParams {
  templateId: string;
  candles: Candle[];
  initialEquity?: number;
  maxVariants?: number;
}

/**
 * Parameter sweep system for strategy optimization
 * Tests multiple parameter combinations and ranks by performance
 */
export class ParameterSweep {
  private backtester: Backtester;

  constructor() {
    this.backtester = new Backtester();
  }

  /**
   * Run parameter sweep on a template
   */
  async runSweep(params: SweepParams): Promise<SweepResult[]> {
    const { templateId, candles, initialEquity = 1000, maxVariants = 20 } = params;

    const template = getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    logger.info({ templateId }, 'Starting parameter sweep');

    // Generate parameter variants based on template category
    const variants = this.generateVariants(template, maxVariants);
    const results: SweepResult[] = [];

    // Run backtest for each variant
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      try {
        logger.info({ variant: i + 1, total: variants.length }, 'Testing variant');

        const result = await this.backtester.runBacktest({
          strategyConfig: variant.config,
          candles,
          initialEquity,
          fastMode: true, // Use fast mode for sweeps
        });

        results.push({
          config: variant.config,
          metrics: {
            totalReturn: result.totalReturn,
            totalReturnPct: result.totalReturnPct,
            maxDrawdown: result.maxDrawdown,
            winRate: result.winRate || 0,
            sharpeRatio: result.performance.sharpe || 0,
            totalTrades: result.trades.length,
            totalFees: result.trades.reduce((sum, t) => sum + t.fees, 0),
          },
          templateId,
          variantName: variant.name,
        });
      } catch (error) {
        logger.error({ error, variant: i }, 'Error testing variant');
      }
    }

    // Rank results
    return this.rankResults(results);
  }

  /**
   * Generate parameter variants for a template
   */
  private generateVariants(template: StrategyTemplate, maxVariants: number): Array<{ name: string; config: StrategyConfig }> {
    const variants: Array<{ name: string; config: StrategyConfig }> = [];

    switch (template.category) {
      case 'momentum':
        // Vary EMA periods and RSI thresholds
        const emaFastOptions = [9, 12, 15];
        const emaSlowOptions = [21, 26, 30];
        const rsiOversoldOptions = [25, 30, 35];
        const rsiOverboughtOptions = [65, 70, 75];

        for (const fast of emaFastOptions) {
          for (const slow of emaSlowOptions) {
            if (slow <= fast) continue; // Slow must be > fast
            for (const oversold of rsiOversoldOptions) {
              for (const overbought of rsiOverboughtOptions) {
                if (variants.length >= maxVariants) break;
                variants.push({
                  name: `EMA${fast}/${slow}_RSI${oversold}/${overbought}`,
                  config: {
                    ...template.config,
                    indicators: {
                      ema: { fast, slow },
                      rsi: { period: 14, overbought, oversold },
                    },
                  },
                });
              }
              if (variants.length >= maxVariants) break;
            }
            if (variants.length >= maxVariants) break;
          }
          if (variants.length >= maxVariants) break;
        }
        break;

      case 'mean-reversion':
        // Vary RSI thresholds and stop loss/take profit
        const rsiLowOptions = [20, 25, 30];
        const rsiHighOptions = [70, 75, 80];
        const slOptions = [1, 1.5, 2];
        const tpOptions = [2, 3, 4];

        for (const low of rsiLowOptions) {
          for (const high of rsiHighOptions) {
            for (const sl of slOptions) {
              for (const tp of tpOptions) {
                if (variants.length >= maxVariants) break;
                variants.push({
                  name: `RSI${low}/${high}_SL${sl}_TP${tp}`,
                  config: {
                    ...template.config,
                    indicators: {
                      rsi: { period: 14, overbought: high, oversold: low },
                    },
                    riskLimits: {
                      ...template.config.riskLimits,
                      stopLossPct: sl,
                      takeProfitPct: tp,
                    },
                  },
                });
              }
              if (variants.length >= maxVariants) break;
            }
            if (variants.length >= maxVariants) break;
          }
          if (variants.length >= maxVariants) break;
        }
        break;

      case 'breakout':
        // Vary ATR period and multipliers
        const atrPeriods = [10, 14, 20];
        const multipliers = [1.2, 1.5, 2.0];

        for (const period of atrPeriods) {
          for (const mult of multipliers) {
            if (variants.length >= maxVariants) break;
            variants.push({
              name: `ATR${period}x${mult}`,
              config: {
                ...template.config,
                indicators: {
                  volatility: { period },
                },
              },
            });
          }
          if (variants.length >= maxVariants) break;
        }
        break;

      case 'trend-following':
        // Vary EMA periods
        const fastOptions = [7, 9, 12];
        const slowOptions = [40, 50, 60];

        for (const fast of fastOptions) {
          for (const slow of slowOptions) {
            if (slow <= fast) continue;
            if (variants.length >= maxVariants) break;
            variants.push({
              name: `EMA${fast}/${slow}`,
              config: {
                ...template.config,
                indicators: {
                  ema: { fast, slow },
                },
              },
            });
          }
          if (variants.length >= maxVariants) break;
        }
        break;
    }

    // If we don't have enough variants, add some with default config
    while (variants.length < Math.min(maxVariants, 5)) {
      variants.push({
        name: `Default_${variants.length + 1}`,
        config: template.config,
      });
    }

    return variants.slice(0, maxVariants);
  }

  /**
   * Rank results by composite score
   * Prioritizes: low drawdown, decent return, realistic trade count
   */
  private rankResults(results: SweepResult[]): SweepResult[] {
    return results
      .map((result) => {
        const { metrics } = result;

        // Composite score: balance return, drawdown, and trade quality
        const returnScore = Math.max(0, metrics.totalReturnPct) * 0.4;
        const drawdownScore = Math.max(0, 10 - metrics.maxDrawdown) * 0.3; // Lower drawdown = better
        const winRateScore = metrics.winRate * 0.2;
        const tradeCountScore = Math.min(1, metrics.totalTrades / 50) * 0.1; // Prefer reasonable trade count

        const compositeScore = returnScore + drawdownScore + winRateScore + tradeCountScore;

        return {
          ...result,
          _score: compositeScore,
        };
      })
      .sort((a, b) => (b as any)._score - (a as any)._score)
      .map(({ _score, ...rest }) => rest);
  }
}

export const parameterSweep = new ParameterSweep();


