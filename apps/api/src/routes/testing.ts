import { FastifyInstance } from 'fastify';
import { logger } from '../config/logger';
import { prisma } from '../config/database';
import { profitabilityTracker } from '../services/profitabilityTracker';
import { dailyReporter } from '../services/dailyReporter';
import { profitGate } from '../services/profitGate';

export async function testingRoutes(fastify: FastifyInstance) {
  // Get overall testing status
  fastify.get('/testing/status', async (request, reply) => {
    try {
      const solanaStrategies = await prisma.strategy.findMany({
        where: {
          chainId: 101, // Solana
          mode: 'PAPER',
        },
        include: {
          profitabilityChecks: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
          trades: {
            where: { mode: 'PAPER' },
          },
        },
      });

      const status = {
        totalStrategies: solanaStrategies.length,
        readyForLive: 0,
        inTesting: 0,
        needsImprovement: 0,
        totalTrades: 0,
        totalDaysTesting: 0,
        strategies: solanaStrategies.map((s) => {
          const latestCheck = s.profitabilityChecks[0];
          const daysTesting = Math.floor(
            (Date.now() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60 * 24)
          );
          
          let status: 'ready' | 'testing' | 'needs_improvement' = 'testing';
          if (latestCheck?.passed) {
            status = 'ready';
          } else if (latestCheck) {
            const progress = calculateProgress(latestCheck);
            if (progress < 25) {
              status = 'needs_improvement';
            }
          }

          return {
            id: s.id,
            name: s.name,
            status,
            daysTesting,
            totalTrades: s.trades.length,
            latestCheck: latestCheck ? {
              timestamp: latestCheck.timestamp,
              passed: latestCheck.passed,
              sharpe: latestCheck.sharpe,
              avgReturn: latestCheck.avgReturn,
              winRate: latestCheck.winRate,
              maxDrawdown: latestCheck.maxDrawdown,
            } : null,
          };
        }),
      };

      // Count statuses
      status.strategies.forEach((s) => {
        if (s.status === 'ready') status.readyForLive++;
        else if (s.status === 'needs_improvement') status.needsImprovement++;
        else status.inTesting++;
        
        status.totalTrades += s.totalTrades;
        status.totalDaysTesting += s.daysTesting;
      });

      return reply.send(status);
    } catch (error: any) {
      logger.error({ error }, 'Error getting testing status');
      return reply.code(500).send({ error: error.message || 'Failed to get testing status' });
    }
  });

  // Get detailed progress for a strategy
  fastify.get('/testing/strategies/:id/progress', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const strategy = await prisma.strategy.findUnique({
        where: { id },
        include: {
          profitabilityChecks: {
            orderBy: { timestamp: 'desc' },
            take: 30, // Last 30 checks
          },
          trades: {
            where: { mode: 'PAPER' },
            orderBy: { timestamp: 'desc' },
          },
        },
      });

      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found' });
      }

      const daysTesting = Math.floor(
        (Date.now() - new Date(strategy.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      );

      const latestCheck = strategy.profitabilityChecks[0];
      const trend = await profitabilityTracker.calculateTrend(id);
      const history = await profitabilityTracker.getHistory(id, 30);

      return reply.send({
        strategyId: id,
        strategyName: strategy.name,
        daysTesting,
        totalTrades: strategy.trades.length,
        latestCheck: latestCheck ? {
          timestamp: latestCheck.timestamp,
          passed: latestCheck.passed,
          sharpe: latestCheck.sharpe,
          avgReturn: latestCheck.avgReturn,
          winRate: latestCheck.winRate,
          maxDrawdown: latestCheck.maxDrawdown,
          message: latestCheck.message,
        } : null,
        trend,
        history,
        progress: latestCheck ? calculateProgress(latestCheck) : 0,
      });
    } catch (error: any) {
      logger.error({ error }, 'Error getting strategy progress');
      return reply.code(500).send({ error: error.message || 'Failed to get progress' });
    }
  });

  // Manually trigger profitability check
  fastify.post('/testing/strategies/:id/check', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const strategy = await prisma.strategy.findUnique({
        where: { id },
      });

      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found' });
      }

      // Run both checks
      const [backtestCheck, recentPerfCheck] = await Promise.all([
        profitGate.checkProfitability(id, 10),
        profitGate.checkRecentPerformance(id),
      ]);

      const checkResult = recentPerfCheck.passed ? recentPerfCheck : backtestCheck;

      // Store the check
      await profitabilityTracker.storeCheck(id, {
        sharpe: checkResult.sharpe,
        avgReturn: checkResult.avgReturn,
        winRate: checkResult.winRate,
        maxDrawdown: checkResult.maxDrawdown,
        passed: checkResult.passed,
        message: checkResult.message,
        details: checkResult.details,
      });

      const trend = await profitabilityTracker.calculateTrend(id);

      return reply.send({
        success: true,
        check: {
          passed: checkResult.passed,
          sharpe: checkResult.sharpe,
          avgReturn: checkResult.avgReturn,
          winRate: checkResult.winRate,
          maxDrawdown: checkResult.maxDrawdown,
          message: checkResult.message,
        },
        trend,
        progress: calculateProgress(checkResult),
      });
    } catch (error: any) {
      logger.error({ error }, 'Error running profitability check');
      return reply.code(500).send({ error: error.message || 'Failed to run check' });
    }
  });

  // Get daily report
  fastify.get('/testing/reports/daily', async (request, reply) => {
    try {
      const report = await dailyReporter.generateDailyReport();
      return reply.send(report);
    } catch (error: any) {
      logger.error({ error }, 'Error generating daily report');
      return reply.code(500).send({ error: error.message || 'Failed to generate report' });
    }
  });
}

// Helper function to calculate progress (updated to realistic but strict targets)
function calculateProgress(check: any): number {
  const requirements = {
    sharpe: { target: 2.0, current: check.sharpe || 0 },
    return: { target: 25, current: check.avgReturn || 0 },
    winRate: { target: 55, current: (check.winRate || 0) * 100 },
    drawdown: { target: 15, current: check.maxDrawdown || 0 },
  };

  let passedCount = 0;
  if (requirements.sharpe.current > requirements.sharpe.target) passedCount++;
  if (requirements.return.current > requirements.return.target) passedCount++;
  if (requirements.winRate.current > requirements.winRate.target) passedCount++;
  if (requirements.drawdown.current < requirements.drawdown.target) passedCount++;

  return (passedCount / 4) * 100;
}

