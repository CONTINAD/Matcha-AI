import { strategyGenerator } from '../services/strategyGenerator';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

/**
 * Generate and create AI-powered strategies
 */
async function generateAndCreateStrategies(count: number = 5) {
  try {
    logger.info({ count }, 'Starting strategy generation...');

    // Get or create default user
    let user = await prisma.user.findFirst({
      where: { email: 'default-user@matcha.ai' },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: 'default-user@matcha.ai',
        },
      });
      logger.info({ userId: user.id }, 'Created default user');
    }

    // Generate strategies
    logger.info('Generating strategies with AI...');
    const strategies = await strategyGenerator.generateStrategies(count);

    logger.info({ count: strategies.length }, 'Strategies generated, creating in database...');

    // Create strategies in database with backtesting
    const strategyIds = await strategyGenerator.createStrategiesInDatabase(
      strategies,
      user.id,
      true // Run backtests
    );

    logger.info(
      { created: strategyIds.length, ids: strategyIds },
      'Strategies created successfully'
    );

    // Show summary
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      const strategyId = strategyIds[i];
      logger.info(
        {
          id: strategyId,
          name: strategy.name,
          chain: strategy.chainId === 101 ? 'Solana' : `Chain ${strategy.chainId}`,
          timeframe: strategy.timeframe,
          universe: strategy.universe,
        },
        'Created strategy'
      );
    }

    return strategyIds;
  } catch (error) {
    logger.error({ error }, 'Error generating strategies');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  const count = parseInt(process.argv[2] || '5', 10);
  generateAndCreateStrategies(count)
    .then((ids) => {
      logger.info({ strategyIds: ids }, 'Strategy generation completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Strategy generation failed');
      process.exit(1);
    });
}

export { generateAndCreateStrategies };


