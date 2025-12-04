#!/usr/bin/env tsx

/**
 * Keep only the 3 most profitable Solana strategies
 * Deletes all other Solana strategies (chainId: 101)
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

interface StrategyMetrics {
  id: string;
  name: string;
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  sharpe?: number;
  score: number; // Combined profitability score
}

/**
 * Calculate profitability score for ranking
 */
function calculateScore(metrics: StrategyMetrics): number {
  // Weighted score: P&L (40%), win rate (30%), trade count (20%), Sharpe (10%)
  const pnlScore = Math.max(0, metrics.totalPnL / 100); // Normalize to 0-1 scale
  const winRateScore = metrics.winRate;
  const tradeScore = Math.min(1, metrics.totalTrades / 50); // Normalize to 0-1
  const sharpeScore = metrics.sharpe ? Math.min(1, Math.max(0, metrics.sharpe / 3)) : 0.5; // Default 0.5 if no Sharpe
  
  return (pnlScore * 0.4) + (winRateScore * 0.3) + (tradeScore * 0.2) + (sharpeScore * 0.1);
}

async function keepOnlyProfitableSolana() {
  try {
    logger.info('Finding all Solana strategies (chainId: 101)...');
    
    // Find all Solana strategies
    const solanaStrategies = await prisma.strategy.findMany({
      where: {
        chainId: 101, // Solana
      },
      include: {
        trades: true,
        performanceSnapshots: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    if (solanaStrategies.length === 0) {
      logger.info('No Solana strategies found');
      return;
    }

    logger.info({ total: solanaStrategies.length }, 'Found Solana strategies');

    // Calculate metrics for each strategy
    const metrics: StrategyMetrics[] = solanaStrategies.map((strategy) => {
      const closedTrades = strategy.trades.filter((t) => t.exitPrice);
      const totalTrades = closedTrades.length;
      const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      const winningTrades = closedTrades.filter((t) => (t.pnl || 0) > 0);
      const winRate = totalTrades > 0 ? winningTrades.length / totalTrades : 0;
      
      // Get latest Sharpe ratio if available
      const latestSnapshot = strategy.performanceSnapshots[0];
      const sharpe = latestSnapshot?.sharpe || undefined;

      return {
        id: strategy.id,
        name: strategy.name,
        totalPnL,
        winRate,
        totalTrades,
        sharpe,
        score: 0, // Will calculate below
      };
    });

    // Calculate scores
    metrics.forEach((m) => {
      m.score = calculateScore(m);
    });

    // Sort by score (highest first)
    metrics.sort((a, b) => b.score - a.score);

    // Identify the 3 most profitable strategies
    const top3Names = [
      'Solana Cross-DEX Arbitrage',
      'Solana RSI Mean Reversion',
      'Solana Momentum Breakout',
    ];

    // Find top 3 by name first (if they exist), then by score
    const keepIds = new Set<string>();
    
    // First, try to keep the 3 named strategies
    for (const name of top3Names) {
      const strategy = metrics.find((m) => m.name === name);
      if (strategy) {
        keepIds.add(strategy.id);
        logger.info(
          { id: strategy.id, name: strategy.name, score: strategy.score.toFixed(3), totalPnL: strategy.totalPnL.toFixed(2), winRate: (strategy.winRate * 100).toFixed(1) + '%' },
          `✅ Keeping: ${strategy.name}`
        );
      }
    }

    // If we don't have 3 yet, add top performers by score
    for (const metric of metrics) {
      if (keepIds.size >= 3) break;
      if (!keepIds.has(metric.id)) {
        keepIds.add(metric.id);
        logger.info(
          { id: metric.id, name: metric.name, score: metric.score.toFixed(3), totalPnL: metric.totalPnL.toFixed(2), winRate: (metric.winRate * 100).toFixed(1) + '%' },
          `✅ Keeping (top performer): ${metric.name}`
        );
      }
    }

    // Delete all others
    const toDelete = metrics.filter((m) => !keepIds.has(m.id));
    
    if (toDelete.length === 0) {
      logger.info('No strategies to delete - already have only 3 or fewer');
      return;
    }

    logger.info({ count: toDelete.length }, 'Deleting non-profitable Solana strategies...');
    
    for (const metric of toDelete) {
      logger.info(
        { id: metric.id, name: metric.name, score: metric.score.toFixed(3), totalPnL: metric.totalPnL.toFixed(2), winRate: (metric.winRate * 100).toFixed(1) + '%' },
        `🗑️  Deleting: ${metric.name}`
      );
      
      await prisma.strategy.delete({
        where: { id: metric.id },
      });
    }

    logger.info({ deleted: toDelete.length, kept: keepIds.size }, 'Cleanup complete');
    
    // Show final list
    const remaining = await prisma.strategy.findMany({
      where: { chainId: 101 },
      select: { id: true, name: true, status: true },
    });
    
    logger.info({ remaining: remaining.length }, 'Remaining Solana strategies:');
    remaining.forEach((s) => {
      logger.info({ id: s.id, name: s.name, status: s.status }, '  Strategy');
    });

  } catch (error) {
    logger.error({ error }, 'Error keeping only profitable Solana strategies');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  keepOnlyProfitableSolana()
    .then(() => {
      logger.info('Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Script failed');
      process.exit(1);
    });
}

export { keepOnlyProfitableSolana };



