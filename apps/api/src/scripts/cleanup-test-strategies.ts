import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

/**
 * Remove all test strategies and strategies with poor performance
 */
async function cleanupTestStrategies() {
  try {
    logger.info('Starting cleanup of test strategies...');

    // Find all strategies
    const allStrategies = await prisma.strategy.findMany({
      include: {
        trades: true,
      },
    });

    logger.info({ total: allStrategies.length }, 'Found strategies');

    const strategiesToDelete: string[] = [];

    for (const strategy of allStrategies) {
      // PROTECT: Never delete strategies with LIVE or PAPER trades (real trading data)
      const hasLiveTrades = strategy.trades.some(t => t.mode === 'LIVE');
      const hasPaperTrades = strategy.trades.some(t => t.mode === 'PAPER');
      const hasBacktestTrades = strategy.trades.some(t => t.mode === 'BACKTEST');
      
      // PROTECT: Never delete active strategies
      if (strategy.status === 'ACTIVE') {
        logger.info(
          { id: strategy.id, name: strategy.name },
          'Protected: Active strategy (skipping)'
        );
        continue;
      }

      // PROTECT: Never delete strategies with real trading data (LIVE or PAPER)
      if (hasLiveTrades || hasPaperTrades) {
        logger.info(
          { id: strategy.id, name: strategy.name, liveTrades: hasLiveTrades, paperTrades: hasPaperTrades },
          'Protected: Has real trading data (skipping)'
        );
        continue;
      }

      // PROTECT: Never delete strategies with significant backtest data (learning data)
      if (hasBacktestTrades && strategy.trades.length >= 10) {
        logger.info(
          { id: strategy.id, name: strategy.name, backtestTrades: strategy.trades.length },
          'Protected: Has significant backtest data for learning (skipping)'
        );
        continue;
      }

      // Check if it's a test strategy by name
      const isTestByName =
        strategy.name.toLowerCase().includes('test') ||
        strategy.name.toLowerCase().includes('demo') ||
        strategy.name.toLowerCase().includes('example') ||
        strategy.name.toLowerCase().includes('sample');

      // Only delete if:
      // 1. Named as test AND has no real trading data
      // 2. Has only BACKTEST trades (not real data) AND terrible performance
      // 3. No trades at all AND old AND named as test
      const closedTrades = strategy.trades.filter((t) => t.exitPrice);
      const totalTrades = closedTrades.length;
      
      if (totalTrades > 0) {
        // Only consider BACKTEST trades for deletion (not PAPER or LIVE)
        const backtestTrades = closedTrades.filter(t => t.mode === 'BACKTEST');
        if (backtestTrades.length === 0) {
          // Has PAPER or LIVE trades - already protected above, but double-check
          continue;
        }

        const totalPnL = backtestTrades.reduce((sum, t) => sum + t.pnl, 0);
        const winRate = backtestTrades.filter((t) => t.pnl > 0).length / backtestTrades.length;
        const avgLoss = totalPnL / backtestTrades.length;

        // Only delete if:
        // 1. Named as test AND has only backtest trades
        // 2. Has many backtest trades but consistently losing (and named as test)
        const isPoorPerformer =
          (backtestTrades.length >= 20 && totalPnL < -200 && winRate < 0.25) ||
          (backtestTrades.length >= 10 && totalPnL < -100 && winRate < 0.2);

        if (isTestByName && isPoorPerformer) {
          strategiesToDelete.push(strategy.id);
          logger.info(
            {
              id: strategy.id,
              name: strategy.name,
              reason: 'test name + poor backtest performance',
              trades: backtestTrades.length,
              pnl: totalPnL,
              winRate: (winRate * 100).toFixed(1) + '%',
            },
            'Marked for deletion (backtest only)'
          );
        }
      } else {
        // No trades - delete if old (more than 30 days) AND named as test
        const daysSinceCreation =
          (Date.now() - new Date(strategy.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (isTestByName && daysSinceCreation > 30) {
          strategiesToDelete.push(strategy.id);
          logger.info(
            {
              id: strategy.id,
              name: strategy.name,
              reason: 'test name + no trades + old',
              daysOld: daysSinceCreation.toFixed(1),
            },
            'Marked for deletion (no trades)'
          );
        }
      }
    }

    // Delete strategies
    if (strategiesToDelete.length > 0) {
      logger.info({ count: strategiesToDelete.length }, 'Deleting strategies...');

      // Delete in batches to avoid overwhelming the database
      for (let i = 0; i < strategiesToDelete.length; i += 10) {
        const batch = strategiesToDelete.slice(i, i + 10);
        await prisma.strategy.deleteMany({
          where: {
            id: {
              in: batch,
            },
          },
        });
        logger.info({ batch: i / 10 + 1, total: strategiesToDelete.length }, 'Deleted batch');
      }

      logger.info({ deleted: strategiesToDelete.length }, 'Cleanup complete');
    } else {
      logger.info('No strategies to delete');
    }

    // Show remaining strategies
    const remaining = await prisma.strategy.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
      },
    });

    logger.info({ remaining: remaining.length }, 'Remaining strategies');
    remaining.forEach((s) => {
      logger.info({ id: s.id, name: s.name, status: s.status }, 'Strategy');
    });
  } catch (error) {
    logger.error({ error }, 'Error during cleanup');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  cleanupTestStrategies()
    .then(() => {
      logger.info('Cleanup script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Cleanup script failed');
      process.exit(1);
    });
}

export { cleanupTestStrategies };


