import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { profitabilityTracker } from './profitabilityTracker';
import { prisma } from '../config/database';

export interface DailyReport {
  date: string;
  totalStrategies: number;
  readyForLive: number;
  inTesting: number;
  needsImprovement: number;
  strategies: Array<{
    id: string;
    name: string;
    status: 'ready' | 'testing' | 'needs_improvement';
    metrics: {
      sharpe?: number;
      avgReturn?: number;
      winRate?: number;
      maxDrawdown?: number;
    };
    trend: {
      improving: boolean;
      declining: boolean;
      predictedDays?: number;
    };
  }>;
}

export class DailyReporter {
  /**
   * Generate daily profitability report for all Solana strategies
   */
  async generateDailyReport(): Promise<DailyReport> {
    logger.info('Generating daily profitability report...');

    try {
      const solanaStrategies = await prisma.strategy.findMany({
        where: {
          chainId: 101, // Solana
          mode: 'PAPER',
        },
        include: {
          profitabilityChecks: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
      });

      const report: DailyReport = {
        date: new Date().toISOString().split('T')[0],
        totalStrategies: solanaStrategies.length,
        readyForLive: 0,
        inTesting: 0,
        needsImprovement: 0,
        strategies: [],
      };

      for (const strategy of solanaStrategies) {
        const latestCheck = strategy.profitabilityChecks[0];
        
        if (!latestCheck) {
          // No checks yet - skip
          continue;
        }

        const trend = await profitabilityTracker.calculateTrend(strategy.id);
        
        let status: 'ready' | 'testing' | 'needs_improvement' = 'testing';
        if (latestCheck.passed) {
          status = 'ready';
          report.readyForLive++;
        } else {
          // Check if needs improvement (declining trend or very low progress)
          const progress = this.calculateProgress(latestCheck);
          if (trend.declining || progress < 25) {
            status = 'needs_improvement';
            report.needsImprovement++;
          } else {
            report.inTesting++;
          }
        }

        report.strategies.push({
          id: strategy.id,
          name: strategy.name,
          status,
          metrics: {
            sharpe: latestCheck.sharpe ?? undefined,
            avgReturn: latestCheck.avgReturn ?? undefined,
            winRate: latestCheck.winRate ?? undefined,
            maxDrawdown: latestCheck.maxDrawdown ?? undefined,
          },
          trend: {
            improving: trend.improving,
            declining: trend.declining,
            predictedDaysToProfitability: trend.predictedDaysToProfitability,
          },
        });
      }

      // Log summary
      logger.info(
        {
          total: report.totalStrategies,
          ready: report.readyForLive,
          testing: report.inTesting,
          needsImprovement: report.needsImprovement,
        },
        'Daily report generated'
      );

      // Log details for each strategy
      report.strategies.forEach((s) => {
        if (s.status === 'ready') {
          logger.info(
            {
              strategyId: s.id,
              name: s.name,
              sharpe: s.metrics.sharpe,
              return: s.metrics.avgReturn,
              winRate: s.metrics.winRate,
            },
            '✅ Ready for live trading'
          );
        } else if (s.status === 'needs_improvement') {
          logger.warn(
            {
              strategyId: s.id,
              name: s.name,
              trend: s.trend.declining ? 'declining' : 'low progress',
            },
            '⚠️ Needs improvement'
          );
        } else {
          logger.info(
            {
              strategyId: s.id,
              name: s.name,
              trend: s.trend.improving ? 'improving' : 'stable',
              predictedDays: s.trend.predictedDaysToProfitability,
            },
            '🔄 Continue testing'
          );
        }
      });

      return report;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, 'Error generating daily report');
      throw error;
    }
  }

  /**
   * Calculate overall progress percentage
   */
  private calculateProgress(check: any): number {
    const requirements = {
      sharpe: { target: 3.0, current: check.sharpe || 0 },
      return: { target: 50, current: check.avgReturn || 0 },
      winRate: { target: 65, current: (check.winRate || 0) * 100 },
      drawdown: { target: 10, current: check.maxDrawdown || 0 },
    };

    let passedCount = 0;
    if (requirements.sharpe.current > requirements.sharpe.target) passedCount++;
    if (requirements.return.current > requirements.return.target) passedCount++;
    if (requirements.winRate.current > requirements.winRate.target) passedCount++;
    if (requirements.drawdown.current < requirements.drawdown.target) passedCount++;

    return (passedCount / 4) * 100;
  }

  /**
   * Run daily report (to be called by scheduler)
   */
  async runDailyReport(): Promise<void> {
    try {
      const report = await this.generateDailyReport();
      
      // Here you could send the report via email, Telegram, etc.
      // For now, just log it
      logger.info({ report }, 'Daily report completed');
    } catch (error: any) {
      logger.error({ error }, 'Error running daily report');
      throw error;
    }
  }
}

export const dailyReporter = new DailyReporter();



