import { PrismaClient } from '@prisma/client';
import { advancedTrainer } from '../services/advancedTrainer';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

/**
 * Auto-training scheduler - runs continuous training for all active strategies
 * Runs every 10 minutes to ensure strategies are constantly learning
 */
export class AutoTrainingScheduler {
  private interval: NodeJS.Timeout | null = null;
  private readonly TRAINING_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes (changed from 10 minutes)

  /**
   * Start the auto-training scheduler
   */
  start(): void {
    if (this.interval) {
      logger.warn('Auto-training scheduler already running');
      return;
    }

    // Run immediately, then every 10 minutes
    this.run();
    this.interval = setInterval(() => this.run(), this.TRAINING_INTERVAL_MS);

    logger.info('Auto-training scheduler started (runs every 10 minutes)');
  }

  /**
   * Stop the auto-training scheduler
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Auto-training scheduler stopped');
    }
  }

  /**
   * Run training for all active strategies
   */
  private async run(): Promise<void> {
    try {
      logger.info('Starting auto-training cycle for all active strategies');

      // Get all active strategies
      const strategies = await prisma.strategy.findMany({
        where: {
          status: 'ACTIVE',
          mode: { in: ['PAPER', 'LIVE'] }, // Only train strategies that are actively trading
        },
      });

      logger.info({ count: strategies.length }, 'Found active strategies to train');

      // Train each strategy
      for (const strategy of strategies) {
        try {
          logger.info({ strategyId: strategy.id, name: strategy.name }, 'Training strategy');
          
          // Run continuous training
          await advancedTrainer.continuousTraining(strategy.id);
          
          logger.info({ strategyId: strategy.id }, 'Strategy training completed');
        } catch (error: any) {
          logger.error(
            { error: error.message, strategyId: strategy.id },
            'Error training strategy (continuing with others)'
          );
          // Continue with other strategies even if one fails
        }
      }

      logger.info('Auto-training cycle completed');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in auto-training scheduler');
    }
  }
}

export const autoTrainingScheduler = new AutoTrainingScheduler();


