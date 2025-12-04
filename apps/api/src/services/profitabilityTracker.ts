import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { profitGate } from './profitGate';
import { prisma } from '../config/database';

export interface ProfitabilityTrend {
  improving: boolean;
  declining: boolean;
  stable: boolean;
  predictedDaysToProfitability?: number;
}

export class ProfitabilityTracker {
  /**
   * Store a profitability check result
   */
  async storeCheck(
    strategyId: string,
    check: {
      sharpe?: number;
      avgReturn?: number;
      winRate?: number;
      maxDrawdown?: number;
      passed: boolean;
      message: string;
      details?: any;
    }
  ): Promise<void> {
    try {
      await prisma.profitabilityCheck.create({
        data: {
          strategyId,
          sharpe: check.sharpe ?? null,
          avgReturn: check.avgReturn ?? null,
          winRate: check.winRate ?? null,
          maxDrawdown: check.maxDrawdown ?? null,
          passed: check.passed,
          details: JSON.stringify(check.details || {}),
          message: check.message,
        },
      });
      logger.info({ strategyId, passed: check.passed }, 'Stored profitability check');
    } catch (error) {
      logger.error({ error, strategyId }, 'Error storing profitability check');
      throw error;
    }
  }

  /**
   * Get historical checks for a strategy
   */
  async getHistory(strategyId: string, days: number = 30): Promise<any[]> {
    const checks = await prisma.profitabilityCheck.findMany({
      where: {
        strategyId,
        timestamp: {
          gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    return checks.map((check) => ({
      timestamp: check.timestamp,
      sharpe: check.sharpe,
      avgReturn: check.avgReturn,
      winRate: check.winRate,
      maxDrawdown: check.maxDrawdown,
      passed: check.passed,
      details: check.details ? JSON.parse(check.details) : {},
      message: check.message,
    }));
  }

  /**
   * Calculate trend from historical checks
   */
  async calculateTrend(strategyId: string): Promise<ProfitabilityTrend> {
    const history = await this.getHistory(strategyId, 30);
    
    if (history.length < 3) {
      return {
        improving: false,
        declining: false,
        stable: true,
      };
    }

    // Calculate trends for each metric
    const sharpeTrend = this.calculateMetricTrend(history.map(h => h.sharpe || 0));
    const returnTrend = this.calculateMetricTrend(history.map(h => h.avgReturn || 0));
    const winRateTrend = this.calculateMetricTrend(history.map(h => (h.winRate || 0) * 100));
    const drawdownTrend = this.calculateMetricTrend(history.map(h => h.maxDrawdown || 0), true); // Lower is better

    // Overall trend: improving if most metrics are improving
    const improvingCount = [sharpeTrend, returnTrend, winRateTrend, drawdownTrend].filter(t => t > 0).length;
    const decliningCount = [sharpeTrend, returnTrend, winRateTrend, drawdownTrend].filter(t => t < 0).length;

    const improving = improvingCount >= 3;
    const declining = decliningCount >= 3;
    const stable = !improving && !declining;

    // Predict days to profitability if improving
    let predictedDaysToProfitability: number | undefined;
    if (improving && history.length >= 5) {
      const latest = history[history.length - 1];
      const progress = this.calculateProgress(latest);
      
      if (progress < 100) {
        // Simple linear projection
        const recentProgress = history.slice(-5).map(h => this.calculateProgress(h));
        const progressRate = (recentProgress[recentProgress.length - 1] - recentProgress[0]) / 5; // per check
        
        if (progressRate > 0) {
          const remainingProgress = 100 - progress;
          predictedDaysToProfitability = Math.ceil((remainingProgress / progressRate) * 6); // Assuming checks every 6 hours
        }
      }
    }

    return {
      improving,
      declining,
      stable,
      predictedDaysToProfitability,
    };
  }

  /**
   * Calculate trend for a single metric (positive = improving, negative = declining)
   */
  private calculateMetricTrend(values: number[], lowerIsBetter: boolean = false): number {
    if (values.length < 2) return 0;
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const change = secondAvg - firstAvg;
    return lowerIsBetter ? -change : change;
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
   * Generate historical report
   */
  async generateReport(strategyId: string): Promise<{
    strategyId: string;
    strategyName: string;
    period: string;
    checks: number;
    latest: any;
    trend: ProfitabilityTrend;
    averages: {
      sharpe: number;
      avgReturn: number;
      winRate: number;
      maxDrawdown: number;
    };
  }> {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new Error('Strategy not found');
    }

    const history = await this.getHistory(strategyId, 30);
    const trend = await this.calculateTrend(strategyId);

    const averages = {
      sharpe: history.reduce((sum, h) => sum + (h.sharpe || 0), 0) / history.length || 0,
      avgReturn: history.reduce((sum, h) => sum + (h.avgReturn || 0), 0) / history.length || 0,
      winRate: history.reduce((sum, h) => sum + (h.winRate || 0), 0) / history.length || 0,
      maxDrawdown: history.reduce((sum, h) => sum + (h.maxDrawdown || 0), 0) / history.length || 0,
    };

    return {
      strategyId,
      strategyName: strategy.name,
      period: '30 days',
      checks: history.length,
      latest: history[history.length - 1] || null,
      trend,
      averages,
    };
  }
}

export const profitabilityTracker = new ProfitabilityTracker();



