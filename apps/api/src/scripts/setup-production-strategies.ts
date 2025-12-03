import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { cleanupTestStrategies } from './cleanup-test-strategies';
import { generateAndCreateStrategies } from './generate-strategies';
import { paperTrader } from '../services/paperTrader';

const prisma = new PrismaClient();

/**
 * Master script to:
 * 1. Clean up test strategies
 * 2. Generate new AI-powered strategies
 * 3. Start paper trading on them
 */
async function setupProductionStrategies() {
  try {
    logger.info('🚀 Starting production strategy setup...');

    // Step 1: Cleanup test strategies
    logger.info('📋 Step 1: Cleaning up test strategies...');
    await cleanupTestStrategies();
    logger.info('✅ Cleanup complete');

    // Step 2: Generate new strategies
    logger.info('🤖 Step 2: Generating AI-powered strategies...');
    const strategyIds = await generateAndCreateStrategies(5);
    logger.info({ count: strategyIds.length }, '✅ Strategies generated');

    // Step 3: Start paper trading on all new strategies
    logger.info('📈 Step 3: Starting paper trading on new strategies...');
    let startedCount = 0;
    
    for (const strategyId of strategyIds) {
      try {
        const strategy = await prisma.strategy.findUnique({
          where: { id: strategyId },
        });

        if (strategy && strategy.mode === 'PAPER') {
          await paperTrader.start(strategyId);
          startedCount++;
          logger.info({ strategyId, name: strategy.name }, '✅ Paper trading started');
        } else {
          logger.warn({ strategyId, mode: strategy?.mode }, '⚠️ Strategy not in PAPER mode, skipping');
        }
      } catch (error) {
        logger.error({ error, strategyId }, '❌ Error starting paper trading');
      }
    }

    logger.info(
      {
        total: strategyIds.length,
        started: startedCount,
      },
      '✅ Production setup complete'
    );

    // Summary
    const allStrategies = await prisma.strategy.findMany({
      where: { mode: 'PAPER', status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        chainId: true,
        timeframe: true,
        createdAt: true,
      },
    });

    logger.info({ count: allStrategies.length }, '📊 Active paper trading strategies:');
    allStrategies.forEach((s) => {
      const chainName =
        s.chainId === 101
          ? 'Solana'
          : s.chainId === 1
          ? 'Ethereum'
          : s.chainId === 137
          ? 'Polygon'
          : s.chainId === 42161
          ? 'Arbitrum'
          : `Chain ${s.chainId}`;
      logger.info(
        {
          id: s.id,
          name: s.name,
          chain: chainName,
          timeframe: s.timeframe,
        },
        '  Strategy'
      );
    });

    return {
      cleanup: true,
      generated: strategyIds.length,
      started: startedCount,
      active: allStrategies.length,
    };
  } catch (error) {
    logger.error({ error }, '❌ Error during production setup');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  setupProductionStrategies()
    .then((result) => {
      logger.info(result, '🎉 Production setup completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, '💥 Production setup failed');
      process.exit(1);
    });
}

export { setupProductionStrategies };

