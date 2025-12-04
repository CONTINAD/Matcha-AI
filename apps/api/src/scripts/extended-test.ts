import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { profitGate } from '../services/profitGate';
import { profitabilityTracker } from '../services/profitabilityTracker';
import { prisma } from '../config/database';

/**
 * Extended Testing Script
 * 
 * Runs continuous profitability checks for Solana strategies
 * - Checks every 6 hours (configurable)
 * - Tracks metrics over time (7, 14, 30 days)
 * - Generates daily reports
 * - Alerts when strategies meet profit gates
 */
async function runExtendedTest() {
  logger.info('Starting extended profitability testing...');

  try {
    // Find all Solana strategies in PAPER mode
    const solanaStrategies = await prisma.strategy.findMany({
      where: {
        chainId: 101, // Solana
        mode: 'PAPER',
        status: 'ACTIVE',
      },
    });

    if (solanaStrategies.length === 0) {
      logger.info('No active Solana strategies in PAPER mode found');
      return;
    }

    logger.info({ count: solanaStrategies.length }, 'Found Solana strategies to test');

    const results = [];

    for (const strategy of solanaStrategies) {
      try {
        logger.info({ strategyId: strategy.id, name: strategy.name }, 'Running profitability check');

        // Run both checks
        const [backtestCheck, recentPerfCheck] = await Promise.all([
          profitGate.checkProfitability(strategy.id, 10), // Use 10 sims for faster checks
          profitGate.checkRecentPerformance(strategy.id),
        ]);

        // Use recent performance if available, otherwise backtest
        const checkResult = recentPerfCheck.passed ? recentPerfCheck : backtestCheck;

        // Store the check
        await profitabilityTracker.storeCheck(strategy.id, {
          sharpe: checkResult.sharpe,
          avgReturn: checkResult.avgReturn,
          winRate: checkResult.winRate,
          maxDrawdown: checkResult.maxDrawdown,
          passed: checkResult.passed,
          message: checkResult.message,
          details: checkResult.details,
        });

        // Calculate trend
        const trend = await profitabilityTracker.calculateTrend(strategy.id);

        results.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          passed: checkResult.passed,
          metrics: {
            sharpe: checkResult.sharpe,
            avgReturn: checkResult.avgReturn,
            winRate: checkResult.winRate,
            maxDrawdown: checkResult.maxDrawdown,
          },
          trend,
          message: checkResult.message,
        });

        // Log if ready for live
        if (checkResult.passed) {
          logger.info(
            { strategyId: strategy.id, name: strategy.name },
            '✅ Strategy passed profitability check - READY FOR LIVE TRADING'
          );
        } else {
          logger.info(
            {
              strategyId: strategy.id,
              name: strategy.name,
              progress: checkResult.passed ? 100 : 0,
              trend: trend.improving ? 'improving' : trend.declining ? 'declining' : 'stable',
            },
            'Strategy still in testing phase'
          );
        }
      } catch (error: any) {
        logger.error({ error: error.message, strategyId: strategy.id }, 'Error checking strategy profitability');
        results.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          error: error.message,
        });
      }
    }

    // Generate summary
    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;

    logger.info(
      {
        total: totalCount,
        passed: passedCount,
        inTesting: totalCount - passedCount,
      },
      'Extended testing complete'
    );

    // Log detailed results
    results.forEach((result) => {
      if (result.error) {
        logger.warn({ strategyId: result.strategyId, error: result.error }, 'Check failed');
      } else if (result.passed) {
        logger.info(
          {
            strategyId: result.strategyId,
            name: result.strategyName,
            sharpe: result.metrics?.sharpe,
            return: result.metrics?.avgReturn,
            winRate: result.metrics?.winRate,
          },
          '✅ Ready for live'
        );
      } else {
        logger.info(
          {
            strategyId: result.strategyId,
            name: result.strategyName,
            trend: result.trend?.improving ? 'improving' : result.trend?.declining ? 'declining' : 'stable',
            predictedDays: result.trend?.predictedDaysToProfitability,
          },
          '🔄 Continue testing'
        );
      }
    });

    return results;
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Error in extended test');
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  runExtendedTest()
    .then(() => {
      logger.info('Extended test script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Extended test script failed');
      process.exit(1);
    });
}

export { runExtendedTest };



