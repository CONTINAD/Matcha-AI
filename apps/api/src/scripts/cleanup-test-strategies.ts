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
      // Check if it's a test strategy by name
      const isTestByName =
        strategy.name.toLowerCase().includes('test') ||
        strategy.name.toLowerCase().includes('demo') ||
        strategy.name.toLowerCase().includes('example') ||
        strategy.name.toLowerCase().includes('sample');

      // Check performance
      const closedTrades = strategy.trades.filter((t) => t.exitPrice);
      const totalTrades = closedTrades.length;
      
      if (totalTrades > 0) {
        const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
        const winRate = closedTrades.filter((t) => t.pnl > 0).length / totalTrades;
        const avgLoss = totalPnL / totalTrades;

        // Delete if:
        // 1. Named as test
        // 2. Has trades but terrible performance (negative P&L and low win rate)
        // 3. Has many trades but consistently losing
        const isPoorPerformer =
          (totalTrades >= 10 && totalPnL < -100 && winRate < 0.3) ||
          (totalTrades >= 5 && totalPnL < -50 && winRate < 0.25) ||
          (totalTrades >= 20 && avgLoss < -5);

        if (isTestByName || isPoorPerformer) {
          strategiesToDelete.push(strategy.id);
          logger.info(
            {
              id: strategy.id,
              name: strategy.name,
              reason: isTestByName ? 'test name' : 'poor performance',
              trades: totalTrades,
              pnl: totalPnL,
              winRate: (winRate * 100).toFixed(1) + '%',
            },
            'Marked for deletion'
          );
        }
      } else {
        // No trades - delete if old (more than 7 days) or named as test
        const daysSinceCreation =
          (Date.now() - new Date(strategy.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (isTestByName || daysSinceCreation > 7) {
          strategiesToDelete.push(strategy.id);
          logger.info(
            {
              id: strategy.id,
              name: strategy.name,
              reason: isTestByName ? 'test name' : 'no trades and old',
              daysOld: daysSinceCreation.toFixed(1),
            },
            'Marked for deletion'
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


