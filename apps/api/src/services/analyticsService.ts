import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { tradeAnalyticsService } from './tradeAnalyticsService';
import { calculateSharpe } from '@matcha-ai/shared';
import type { Trade, PerformanceMetrics } from '@matcha-ai/shared';
import type { ExecutionQuality } from '@matcha-ai/shared';

const prisma = new PrismaClient();

export interface AnalyticsData {
  totalTrades: number;
  profitableTrades: number;
  losingTrades: number;
  bestTrade: Trade | null;
  worstTrade: Trade | null;
  avgProfit: number;
  avgLoss: number;
  tradesByHour: Record<number, number>;
  tradesByDay: Record<string, number>;
  strategyPerformance: Array<{
    strategyId: string;
    strategyName: string;
    trades: number;
    pnl: number;
    winRate: number;
  }>;
}

export interface ExecutionQualityMetrics {
  avgSlippageBps: number;
  avgFillRate: number;
  avgExecutionTimeMs: number;
  qualityScore: number; // 0-1
  tradesAnalyzed: number;
}

export interface PerformanceAnalytics {
  strategyId?: string;
  timeRange: {
    from: number;
    to: number;
  };
  performance: PerformanceMetrics;
  executionQuality: ExecutionQualityMetrics;
  trades: Trade[];
}

export class AnalyticsService {
  /**
   * Get trade analytics for a time range
   */
  async getTradeAnalytics(
    strategyIds?: string[],
    fromTime?: number,
    toTime?: number
  ): Promise<AnalyticsData> {
    const now = Date.now();
    const from = fromTime || now - 7 * 24 * 60 * 60 * 1000; // Default: last 7 days
    const to = toTime || now;

    const where: any = {
      timestamp: {
        gte: new Date(from),
        lte: new Date(to),
      },
      exitPrice: {
        not: null, // Only closed trades
      },
    };

    if (strategyIds && strategyIds.length > 0) {
      where.strategyId = { in: strategyIds };
    }

    const allTrades = await prisma.trade.findMany({
      where,
      include: {
        strategy: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
    });

    if (allTrades.length === 0) {
      return {
        totalTrades: 0,
        profitableTrades: 0,
        losingTrades: 0,
        bestTrade: null,
        worstTrade: null,
        avgProfit: 0,
        avgLoss: 0,
        tradesByHour: {},
        tradesByDay: {},
        strategyPerformance: [],
      };
    }

    const profitableTrades = allTrades.filter((t) => (t.pnl || 0) > 0);
    const losingTrades = allTrades.filter((t) => (t.pnl || 0) < 0);

    const bestTrade =
      allTrades.length > 0
        ? allTrades.reduce((best, t) => ((t.pnl || 0) > (best.pnl || 0) ? t : best))
        : null;

    const worstTrade =
      allTrades.length > 0
        ? allTrades.reduce((worst, t) => ((t.pnl || 0) < (worst.pnl || 0) ? t : worst))
        : null;

    const avgProfit =
      profitableTrades.length > 0
        ? profitableTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / profitableTrades.length
        : 0;

    const avgLoss =
      losingTrades.length > 0
        ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
        : 0;

    // Group by hour
    const tradesByHour: Record<number, number> = {};
    allTrades.forEach((t) => {
      const hour = new Date(t.timestamp).getHours();
      tradesByHour[hour] = (tradesByHour[hour] || 0) + 1;
    });

    // Group by day
    const tradesByDay: Record<string, number> = {};
    allTrades.forEach((t) => {
      const day = new Date(t.timestamp).toLocaleDateString();
      tradesByDay[day] = (tradesByDay[day] || 0) + 1;
    });

    // Strategy performance
    const strategyMap: Record<string, { name: string; trades: any[] }> = {};
    allTrades.forEach((t: any) => {
      if (!strategyMap[t.strategyId]) {
        strategyMap[t.strategyId] = { name: t.strategy?.name || 'Unknown', trades: [] };
      }
      strategyMap[t.strategyId].trades.push(t);
    });

    const strategyPerformance = Object.entries(strategyMap).map(([id, data]) => {
      const profitable = data.trades.filter((t: any) => (t.pnl || 0) > 0).length;
      const totalPnL = data.trades.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
      return {
        strategyId: id,
        strategyName: data.name,
        trades: data.trades.length,
        pnl: totalPnL,
        winRate: data.trades.length > 0 ? profitable / data.trades.length : 0,
      };
    });

    return {
      totalTrades: allTrades.length,
      profitableTrades: profitableTrades.length,
      losingTrades: losingTrades.length,
      bestTrade: bestTrade as any,
      worstTrade: worstTrade as any,
      avgProfit,
      avgLoss,
      tradesByHour,
      tradesByDay,
      strategyPerformance: strategyPerformance.sort((a, b) => b.pnl - a.pnl),
    };
  }

  /**
   * Get execution quality metrics
   */
  async getExecutionQualityMetrics(strategyId?: string, fromTime?: number, toTime?: number): Promise<ExecutionQualityMetrics> {
    const now = Date.now();
    const from = fromTime || now - 7 * 24 * 60 * 60 * 1000;
    const to = toTime || now;

    const where: any = {
      timestamp: {
        gte: new Date(from),
        lte: new Date(to),
      },
    };

    if (strategyId) {
      where.strategyId = strategyId;
    }

    const analytics = await prisma.tradeAnalytics.findMany({
      where,
      orderBy: {
        timestamp: 'desc',
      },
    });

    if (analytics.length === 0) {
      return {
        avgSlippageBps: 0,
        avgFillRate: 0,
        avgExecutionTimeMs: 0,
        qualityScore: 0,
        tradesAnalyzed: 0,
      };
    }

    const totalSlippage = analytics.reduce((sum: number, a: any) => sum + a.slippageBps, 0);
    const totalFillRate = analytics.reduce((sum: number, a: any) => sum + a.fillRate, 0);
    const totalExecutionTime = analytics.reduce((sum: number, a: any) => sum + a.executionTimeMs, 0);

    const avgSlippageBps = totalSlippage / analytics.length;
    const avgFillRate = totalFillRate / analytics.length;
    const avgExecutionTimeMs = totalExecutionTime / analytics.length;

    // Calculate overall quality score
    const slippageScore = Math.max(0, 1 - avgSlippageBps / 10000);
    const fillRateScore = avgFillRate;
    const timeScore = Math.max(0, 1 - avgExecutionTimeMs / 60000);
    const qualityScore = slippageScore * 0.5 + fillRateScore * 0.3 + timeScore * 0.2;

    return {
      avgSlippageBps: Math.round(avgSlippageBps),
      avgFillRate,
      avgExecutionTimeMs: Math.round(avgExecutionTimeMs),
      qualityScore,
      tradesAnalyzed: analytics.length,
    };
  }

  /**
   * Get performance metrics for a strategy or all strategies
   */
  async getPerformanceMetrics(
    strategyId?: string,
    fromTime?: number,
    toTime?: number
  ): Promise<PerformanceMetrics> {
    const now = Date.now();
    const from = fromTime || now - 30 * 24 * 60 * 60 * 1000; // Default: last 30 days
    const to = toTime || now;

    const where: any = {
      timestamp: {
        gte: new Date(from),
        lte: new Date(to),
      },
      exitPrice: {
        not: null,
      },
    };

    if (strategyId) {
      where.strategyId = strategyId;
    }

    const trades = await prisma.trade.findMany({
      where,
      orderBy: {
        timestamp: 'asc',
      },
    });

    if (trades.length === 0) {
      return {
        realizedPnl: 0,
        maxDrawdown: 0,
        winRate: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
      };
    }

    const closedTrades = trades.filter((t) => t.exitPrice !== null);
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winningTrades = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
    const losingTrades = closedTrades.filter((t) => (t.pnl || 0) < 0).length;
    const winRate = closedTrades.length > 0 ? winningTrades / closedTrades.length : 0;

    // Calculate equity curve for drawdown
    let equity = 10000; // Starting equity (should be configurable)
    const equityCurve: number[] = [equity];
    const returns: number[] = [];

    for (const trade of closedTrades) {
      equity += trade.pnl || 0;
      equityCurve.push(equity);
      if (trade.pnlPct) {
        returns.push(trade.pnlPct / 100);
      }
    }

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = equityCurve[0];
    for (const value of equityCurve) {
      if (value > peak) {
        peak = value;
      }
      const drawdown = ((peak - value) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const sharpe = returns.length > 1 ? calculateSharpe(returns) : undefined;

    return {
      realizedPnl: totalPnl,
      maxDrawdown,
      winRate,
      sharpe,
      totalTrades: closedTrades.length,
      winningTrades,
      losingTrades,
    };
  }

  /**
   * Get comprehensive analytics for a strategy
   */
  async getStrategyAnalytics(
    strategyId: string,
    fromTime?: number,
    toTime?: number
  ): Promise<PerformanceAnalytics> {
    const now = Date.now();
    const from = fromTime || now - 30 * 24 * 60 * 60 * 1000;
    const to = toTime || now;

    const [performance, executionQuality, trades] = await Promise.all([
      this.getPerformanceMetrics(strategyId, from, to),
      this.getExecutionQualityMetrics(strategyId, from, to),
      prisma.trade.findMany({
        where: {
          strategyId,
          timestamp: {
            gte: new Date(from),
            lte: new Date(to),
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: 100, // Limit to recent 100 trades
      }),
    ]);

    return {
      strategyId,
      timeRange: {
        from,
        to,
      },
      performance,
      executionQuality,
      trades: trades as any[],
    };
  }
}

export const analyticsService = new AnalyticsService();

