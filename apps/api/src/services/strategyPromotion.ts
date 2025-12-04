import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { matchaBrain } from './matchaBrain';

const prisma = new PrismaClient();

export type PromotionStatus = 'RESEARCH' | 'PAPER' | 'LIVE_SMALL' | 'LIVE_NORMAL';

export interface PromotionAnalysis {
  canPromote: boolean;
  currentStatus: PromotionStatus;
  recommendedNext: PromotionStatus | null;
  backtestMetrics?: {
    totalReturnPct: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
  };
  paperMetrics?: {
    totalReturnPct: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    daysRunning: number;
  };
  aiCommentary: string;
  warnings: string[];
  recommendations: string[];
}

/**
 * Analyze strategy readiness for promotion
 */
export async function analyzePromotion(strategyId: string): Promise<PromotionAnalysis> {
  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
    include: {
      trades: {
        orderBy: { timestamp: 'desc' },
        take: 100,
      },
      performanceSnapshots: {
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
  });

  if (!strategy) {
    throw new Error('Strategy not found');
  }

  // Determine current status
  let currentStatus: PromotionStatus = 'RESEARCH';
  if (strategy.mode === 'LIVE') {
    // Check if it's small or normal based on recent trades
    const liveTrades = strategy.trades.filter((t) => t.mode === 'LIVE');
    currentStatus = liveTrades.length < 10 ? 'LIVE_SMALL' : 'LIVE_NORMAL';
  } else if (strategy.mode === 'PAPER') {
    currentStatus = 'PAPER';
  }

  // Get backtest metrics
  const backtestTrades = strategy.trades.filter((t) => t.mode === 'BACKTEST');
  const backtestMetrics = backtestTrades.length > 0 ? {
    totalReturnPct: (backtestTrades.reduce((sum, t) => sum + t.pnl, 0) / 1000) * 100, // Assuming 1000 initial
    maxDrawdown: strategy.performanceSnapshots[0]?.maxDrawdown || 0,
    winRate: backtestTrades.filter((t) => t.pnl > 0).length / backtestTrades.length || 0,
    totalTrades: backtestTrades.length,
  } : undefined;

  // Get paper trading metrics
  const paperTrades = strategy.trades.filter((t) => t.mode === 'PAPER');
  const paperStartTime = paperTrades.length > 0 
    ? Math.min(...paperTrades.map((t) => t.timestamp.getTime()))
    : null;
  const daysRunning = paperStartTime 
    ? (Date.now() - paperStartTime) / (1000 * 60 * 60 * 24)
    : 0;

  const paperMetrics = paperTrades.length > 0 ? {
    totalReturnPct: (paperTrades.reduce((sum, t) => sum + t.pnl, 0) / 1000) * 100,
    maxDrawdown: strategy.performanceSnapshots[0]?.maxDrawdown || 0,
    winRate: paperTrades.filter((t) => t.pnl > 0).length / paperTrades.length || 0,
    totalTrades: paperTrades.length,
    daysRunning,
  } : undefined;

  // Determine if can promote
  let canPromote = false;
  let recommendedNext: PromotionStatus | null = null;
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (currentStatus === 'RESEARCH') {
    if (backtestMetrics && backtestMetrics.totalTrades >= 10) {
      if (backtestMetrics.totalReturnPct > 0 && backtestMetrics.maxDrawdown < 10) {
        canPromote = true;
        recommendedNext = 'PAPER';
        recommendations.push('Backtest looks good! Start paper trading to validate with live data.');
      } else {
        warnings.push('Backtest shows negative returns or high drawdown. Consider adjusting parameters.');
      }
    } else {
      warnings.push('Need at least 10 backtest trades before promoting to paper trading.');
    }
  } else if (currentStatus === 'PAPER') {
    if (paperMetrics) {
      if (paperMetrics.daysRunning >= 1 && paperMetrics.totalTrades >= 20) {
        if (paperMetrics.totalReturnPct > 0 && paperMetrics.maxDrawdown < 10 && paperMetrics.winRate >= 0.4) {
          canPromote = true;
          recommendedNext = 'LIVE_SMALL';
          recommendations.push('Paper trading is stable and profitable. Ready for small live trading.');
        } else {
          warnings.push('Paper trading metrics not yet stable. Wait longer or adjust strategy.');
        }
      } else {
        warnings.push(`Need at least 1 day and 20 trades in paper mode. Current: ${paperMetrics.daysRunning.toFixed(1)} days, ${paperMetrics.totalTrades} trades.`);
      }
    } else {
      warnings.push('No paper trading data yet. Start paper trading first.');
    }
  } else if (currentStatus === 'LIVE_SMALL') {
    const liveTrades = strategy.trades.filter((t) => t.mode === 'LIVE');
    if (liveTrades.length >= 10) {
      const liveWinRate = liveTrades.filter((t) => t.pnl > 0).length / liveTrades.length;
      const liveReturn = (liveTrades.reduce((sum, t) => sum + t.pnl, 0) / 1000) * 100;
      
      if (liveReturn > 0 && liveWinRate >= 0.4) {
        canPromote = true;
        recommendedNext = 'LIVE_NORMAL';
        recommendations.push('Small live trading is profitable. Consider scaling up gradually.');
      } else {
        warnings.push('Live trading performance not yet proven. Continue with small size.');
      }
    } else {
      warnings.push('Need at least 10 live trades before considering scale-up.');
    }
  }

  // Get AI commentary
  let aiCommentary = '';
  try {
    const config = JSON.parse(strategy.configJson);
    const recentTrades = strategy.trades.slice(0, 20);
    
    if (recentTrades.length > 0) {
      const perf = {
        realizedPnl: recentTrades.reduce((sum, t) => sum + t.pnl, 0),
        maxDrawdown: strategy.performanceSnapshots[0]?.maxDrawdown || 0,
        winRate: recentTrades.filter((t) => t.pnl > 0).length / recentTrades.length,
        sharpe: 0,
        totalTrades: recentTrades.length,
      };

      const commentary = await matchaBrain.getConfigSuggestions(
        strategy.name,
        config,
        perf,
        recentTrades as any
      );

      aiCommentary = commentary.reasoning;
    }
  } catch (error) {
    logger.error({ error }, 'Error getting AI commentary');
    aiCommentary = 'Unable to generate AI commentary at this time.';
  }

  return {
    canPromote,
    currentStatus,
    recommendedNext,
    backtestMetrics,
    paperMetrics,
    aiCommentary,
    warnings,
    recommendations,
  };
}

/**
 * Promote strategy to next stage
 */
export async function promoteStrategy(strategyId: string, targetStatus: PromotionStatus): Promise<void> {
  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
  });

  if (!strategy) {
    throw new Error('Strategy not found');
  }

  // Validate promotion
  const analysis = await analyzePromotion(strategyId);
  if (!analysis.canPromote || analysis.recommendedNext !== targetStatus) {
    throw new Error(`Cannot promote to ${targetStatus}. Current status: ${analysis.currentStatus}, Recommended: ${analysis.recommendedNext}`);
  }

  // Update strategy
  if (targetStatus === 'PAPER') {
    await prisma.strategy.update({
      where: { id: strategyId },
      data: { mode: 'PAPER' },
    });
  } else if (targetStatus === 'LIVE_SMALL' || targetStatus === 'LIVE_NORMAL') {
    await prisma.strategy.update({
      where: { id: strategyId },
      data: { mode: 'LIVE' },
    });
  }

  logger.info({ strategyId, targetStatus }, 'Strategy promoted');
}




