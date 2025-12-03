import { PrismaClient } from '@prisma/client';
import { matchaBrain } from '../services/matchaBrain';
import { reinforcementLearning } from '../services/reinforcementLearning';
import type { StrategyConfig, PerformanceMetrics, Trade } from '@matcha-ai/shared';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export class LearningLoop {
  private interval: NodeJS.Timeout | null = null;

  /**
   * Start the learning loop (runs daily)
   */
  start(): void {
    if (this.interval) {
      logger.warn('Learning loop already running');
      return;
    }

    // Run immediately, then every 24 hours
    this.run();
    this.interval = setInterval(() => this.run(), 24 * 60 * 60 * 1000);

    logger.info('Learning loop started');
  }

  /**
   * Stop the learning loop
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Learning loop stopped');
    }
  }

  /**
   * Run learning loop for all active strategies
   */
  private async run(): Promise<void> {
    try {
      const activeStrategies = await prisma.strategy.findMany({
        where: { status: 'ACTIVE' },
      });

      logger.info({ count: activeStrategies.length }, 'Running learning loop');

      for (const strategy of activeStrategies) {
        try {
          await this.processStrategy(strategy.id);
        } catch (error) {
          logger.error({ error, strategyId: strategy.id }, 'Error processing strategy in learning loop');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error in learning loop');
    }
  }

  /**
   * Process a single strategy and generate config suggestions
   */
  private async processStrategy(strategyId: string): Promise<void> {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) return;

    const config: StrategyConfig = JSON.parse(strategy.configJson);

    // Get recent trades (last 30 or last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentTrades = await prisma.trade.findMany({
      where: {
        strategyId,
        timestamp: {
          gte: thirtyDaysAgo,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });

    if (recentTrades.length < 5) {
      logger.info({ strategyId }, 'Not enough trades for learning loop');
      return;
    }

    // Calculate performance metrics
    const closedTrades = recentTrades.filter((t) => t.exitPrice);
    const realizedPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
    const winningTrades = closedTrades.filter((t) => t.pnl > 0);
    const winRate = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;

    // Get recent performance snapshots
    const recentSnapshots = await prisma.performanceSnapshot.findMany({
      where: { strategyId },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    const maxDrawdown = recentSnapshots.length > 0 ? Math.max(...recentSnapshots.map((s) => s.maxDrawdown)) : 0;

    const performance: PerformanceMetrics = {
      realizedPnl,
      maxDrawdown,
      winRate,
      totalTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: closedTrades.length - winningTrades.length,
    };

    // Analyze learned patterns
    const learnedPatterns = await reinforcementLearning.analyzePatterns(strategyId, 5);
    
    // Enhanced reasoning with pattern analysis
    let enhancedReasoning = '';
    if (learnedPatterns.length > 0) {
      const winningPatterns = learnedPatterns.filter((p) => p.outcome === 'win');
      const losingPatterns = learnedPatterns.filter((p) => p.outcome === 'loss');
      
      enhancedReasoning = `Pattern Analysis:\n`;
      enhancedReasoning += `- ${winningPatterns.length} winning patterns identified (avg confidence: ${(winningPatterns.reduce((sum, p) => sum + p.confidence, 0) / winningPatterns.length || 0).toFixed(2)})\n`;
      enhancedReasoning += `- ${losingPatterns.length} losing patterns identified (avg confidence: ${(losingPatterns.reduce((sum, p) => sum + p.confidence, 0) / losingPatterns.length || 0).toFixed(2)})\n`;
    }

    // Get config suggestions from AI
    const { suggestedConfigJson, reasoning } = await matchaBrain.getConfigSuggestions(
      strategy.name,
      config,
      performance,
      recentTrades as Trade[]
    );

    // Combine AI reasoning with pattern analysis
    const fullReasoning = `${reasoning}\n\n${enhancedReasoning}`;

    // Store suggestion
    await prisma.configSuggestion.create({
      data: {
        strategyId,
        oldConfigJson: strategy.configJson,
        suggestedConfigJson,
        reasoning: fullReasoning,
        status: 'PENDING',
      },
    });

    logger.info({ strategyId, patternsFound: learnedPatterns.length }, 'Config suggestion created with pattern analysis');
  }

  /**
   * Manually trigger learning loop for a specific strategy
   */
  async triggerForStrategy(strategyId: string): Promise<void> {
    await this.processStrategy(strategyId);
  }
}

export const learningLoop = new LearningLoop();

