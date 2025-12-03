import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { backtester } from '../services/backtester';
import { dataFeed } from '../services/dataFeed';
import { paperTrader } from '../services/paperTrader';
import { liveTrader } from '../services/liveTrader';
import { matchaBrain } from '../services/matchaBrain';
import { STRATEGY_TEMPLATES, getTemplate, getTemplatesByCategory } from '../services/strategyTemplates';
import { parameterSweep } from '../services/parameterSweep';
import { analyzePromotion, promoteStrategy } from '../services/strategyPromotion';
import { cleanupTestStrategies } from '../scripts/cleanup-test-strategies';
import { generateAndCreateStrategies } from '../scripts/generate-strategies';
import { strategyGenerator } from '../services/strategyGenerator';
import { predictionTrainer } from '../services/predictionTrainer';
import { limitOrderService } from '../services/limitOrderService';
import { mevProtection } from '../services/mevProtection';
import { multiTimeframeAnalyzer } from '../services/multiTimeframeAnalyzer';
import { copyTradingService } from '../services/copyTradingService';
import { portfolioRebalancer } from '../services/portfolioRebalancer';
import { advancedTrainer } from '../services/advancedTrainer';
import type { StrategyConfig } from '@matcha-ai/shared';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export async function strategyRoutes(fastify: FastifyInstance) {
  // Create or update strategy
  fastify.post('/strategies', async (request, reply) => {
    try {
      const body = request.body as {
        userId?: string;
        name: string;
        description?: string;
        mode: 'SIMULATION' | 'PAPER' | 'LIVE';
        baseAsset: string;
        universe: string[];
        timeframe: string;
        chainId?: number;
        configJson?: string;
        maxPositionPct?: number;
        maxDailyLossPct?: number;
        stopLossPct?: number;
        takeProfitPct?: number;
        trailingStopPct?: number;
      };

      // Get or create default user if userId not provided
      let userId = body.userId;
      if (!userId) {
        let user = await prisma.user.findUnique({
          where: { email: 'default-user@matcha.ai' },
        });
        if (!user) {
          user = await prisma.user.create({
            data: { email: 'default-user@matcha.ai' },
          });
        }
        userId = user.id;
      } else {
        // Verify user exists
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });
        if (!user) {
          return reply.code(404).send({ error: 'User not found' });
        }
      }

      const config: StrategyConfig = body.configJson
        ? JSON.parse(body.configJson)
        : {
            baseAsset: body.baseAsset,
            universe: body.universe,
            timeframe: body.timeframe,
            riskLimits: {
              maxPositionPct: body.maxPositionPct || 10,
              maxDailyLossPct: body.maxDailyLossPct || 5,
              stopLossPct: body.stopLossPct,
              takeProfitPct: body.takeProfitPct,
              trailingStopPct: body.trailingStopPct,
            },
          };

      const strategy = await prisma.strategy.create({
        data: {
          userId: userId,
          name: body.name,
          description: body.description,
          mode: body.mode,
          baseAsset: body.baseAsset,
          universeJson: JSON.stringify(body.universe),
          timeframe: body.timeframe,
          chainId: body.chainId || 1,
          configJson: JSON.stringify(config),
          status: 'PAUSED',
        },
      });

      return reply.code(201).send(strategy);
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, 'Error creating strategy');
      return reply.code(500).send({ 
        error: 'Failed to create strategy',
        message: error.message || 'Unknown error'
      });
    }
  });

  // Get strategy by ID
  fastify.get('/strategies/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const strategy = await prisma.strategy.findUnique({
        where: { id },
        include: {
          trades: {
            take: 10,
            orderBy: { timestamp: 'desc' },
          },
        },
      });

      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found' });
      }

      return reply.send(strategy);
    } catch (error) {
      logger.error({ error }, 'Error getting strategy');
      return reply.code(500).send({ error: 'Failed to get strategy' });
    }
  });

  // Update strategy
  fastify.put('/strategies/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        mode?: 'SIMULATION' | 'PAPER' | 'LIVE';
        status?: 'ACTIVE' | 'PAUSED';
        name?: string;
        description?: string;
      };

      const updateData: any = {};
      if (body.mode) updateData.mode = body.mode;
      if (body.status) updateData.status = body.status;
      if (body.name) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;

      const strategy = await prisma.strategy.update({
        where: { id },
        data: updateData,
      });

      return reply.send(strategy);
    } catch (error) {
      logger.error({ error }, 'Error updating strategy');
      return reply.code(500).send({ error: 'Failed to update strategy' });
    }
  });

  // List strategies (with quality filtering)
  fastify.get('/strategies', async (request, reply) => {
    try {
      const { userId, quality = 'good' } = request.query as { userId?: string; quality?: 'all' | 'good' | 'active' };
      const where = userId ? { userId } : {};

      let strategies = await prisma.strategy.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          trades: {
            take: 1,
            orderBy: { timestamp: 'desc' },
          },
        },
      });

      // Filter to only show good/active strategies
      if (quality === 'good' || quality === 'active') {
        strategies = await Promise.all(
          strategies.map(async (strategy) => {
            // Get performance data
            const trades = await prisma.trade.findMany({
              where: { strategyId: strategy.id },
            });
            const closedTrades = trades.filter((t) => t.exitPrice);
            
            if (closedTrades.length === 0) {
              // New strategies without trades - only show if recently created (last 7 days)
              const daysSinceCreation = (Date.now() - new Date(strategy.createdAt).getTime()) / (1000 * 60 * 60 * 24);
              if (daysSinceCreation > 7) return null;
              return strategy;
            }

            const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
            const winRate = closedTrades.filter((t) => t.pnl > 0).length / closedTrades.length;
            const totalTrades = closedTrades.length;

            // Quality criteria:
            // 1. Has at least 10 trades (proven)
            // 2. Win rate > 40% (not terrible)
            // 3. OR positive P&L (profitable)
            // 4. OR active in last 7 days (recent activity)
            const hasRecentActivity = trades.length > 0 && 
              (Date.now() - new Date(trades[0].timestamp).getTime()) < 7 * 24 * 60 * 60 * 1000;
            
            const isGood = 
              (totalTrades >= 10 && winRate >= 0.4) || // Proven with decent win rate
              (totalTrades >= 5 && totalPnL > 0) || // Profitable with some trades
              (hasRecentActivity && strategy.status === 'ACTIVE'); // Recently active

            return isGood ? strategy : null;
          })
        );
        strategies = strategies.filter((s): s is NonNullable<typeof s> => s !== null);
      }

      // Remove trades from response (not needed in list)
      return reply.send(strategies.map(({ trades, ...strategy }) => strategy));
    } catch (error) {
      logger.error({ error }, 'Error listing strategies');
      return reply.code(500).send({ error: 'Failed to list strategies' });
    }
  });

  // Run backtest
  fastify.post('/strategies/:id/backtest', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        from?: number;
        to?: number;
        initialEquity?: number;
      };

      const strategy = await prisma.strategy.findUnique({
        where: { id },
      });

      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found' });
      }

      const config: StrategyConfig = JSON.parse(strategy.configJson);
      const universe = JSON.parse(strategy.universeJson) as string[];

      const from = body.from || Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
      const to = body.to || Date.now();
      const initialEquity = body.initialEquity || 10000;

      // Get historical candles for first symbol (simplified)
      let candles = await dataFeed.getHistoricalCandles({
        symbol: universe[0] || 'USDC',
        timeframe: strategy.timeframe,
        from,
        to,
        chainId: strategy.chainId || 1,
      });

      // Limit candles for faster backtesting (max 100 candles)
      // Skip candles to reduce processing time
      if (candles.length > 100) {
        const skip = Math.ceil(candles.length / 100);
        candles = candles.filter((_, i) => i % skip === 0);
        logger.info({ originalCount: candles.length * skip, limitedCount: candles.length }, 'Limited candles for faster backtest');
      }

      let persistedTrades = 0;
      let persistedSnapshots = 0;

      const result = await backtester.runBacktest({
        strategyId: id,
        strategyConfig: config,
        candles,
        initialEquity,
        fastMode: true, // Use fast rule-based decisions instead of AI
        onTrade: async (trade) => {
          persistedTrades += 1;
          await prisma.trade.create({
            data: {
              strategyId: id,
              timestamp: new Date(trade.timestamp),
              mode: 'BACKTEST',
              symbol: trade.symbol,
              side: trade.side,
              size: trade.size,
              entryPrice: trade.entryPrice,
              exitPrice: trade.exitPrice,
              fees: trade.fees,
              slippage: trade.slippage,
              pnl: trade.pnl,
              pnlPct: trade.pnlPct,
            },
          });
        },
        onSnapshot: async (snapshot) => {
          persistedSnapshots += 1;
          await prisma.performanceSnapshot.create({
            data: {
              strategyId: id,
              timestamp: new Date(snapshot.timestamp),
              equityCurvePoint: snapshot.equity,
              maxDrawdown: snapshot.maxDrawdown,
              sharpe: snapshot.sharpe,
              winRate: snapshot.winRate,
              totalTrades: snapshot.totalTrades,
            },
          });
        },
      });

      // Fallback persistence if hooks failed or were not used
      if (persistedTrades === 0 && result.trades.length > 0) {
        await prisma.trade.createMany({
          data: result.trades.map((trade) => ({
            strategyId: id,
            timestamp: new Date(trade.timestamp),
            mode: 'BACKTEST',
            symbol: trade.symbol,
            side: trade.side,
            size: trade.size,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            fees: trade.fees,
            slippage: trade.slippage,
            pnl: trade.pnl,
            pnlPct: trade.pnlPct,
          })),
        });
      }

      if (persistedSnapshots === 0) {
        await prisma.performanceSnapshot.create({
          data: {
            strategyId: id,
            timestamp: new Date(),
            equityCurvePoint: result.finalEquity,
            maxDrawdown: result.performance.maxDrawdown,
            sharpe: result.performance.sharpe,
            winRate: result.performance.winRate,
            totalTrades: result.performance.totalTrades || 0,
          },
        });
      }

      return reply.send(result);
    } catch (error) {
      logger.error({ error }, 'Error running backtest');
      return reply.code(500).send({ error: 'Failed to run backtest' });
    }
  });

  // Start paper trading
  fastify.post('/strategies/:id/paper/start', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await paperTrader.start(id);
      return reply.send({ message: 'Paper trading started' });
    } catch (error) {
      logger.error({ error }, 'Error starting paper trading');
      return reply.code(500).send({ error: 'Failed to start paper trading' });
    }
  });

  // Stop paper trading
  fastify.post('/strategies/:id/paper/stop', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await paperTrader.stop(id);
      return reply.send({ message: 'Paper trading stopped' });
    } catch (error) {
      logger.error({ error }, 'Error stopping paper trading');
      return reply.code(500).send({ error: 'Failed to stop paper trading' });
    }
  });

  // Start live trading (EVM only - Solana not supported)
  fastify.post('/strategies/:id/live/start', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { walletId?: string };
      
      // Check strategy chain before starting
      const strategy = await prisma.strategy.findUnique({
        where: { id },
        select: { chainId: true, mode: true },
      });
      
      if (strategy?.chainId === 101) {
        return reply.code(400).send({
          error: 'Solana live trading not supported',
          message: 'Live trading is only available for EVM chains (Ethereum, Polygon, Arbitrum). Use SIMULATION or PAPER mode for Solana strategies.',
        });
      }
      
      await liveTrader.start(id, body.walletId);
      return reply.send({ message: 'Live trading started' });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error starting live trading');
      return reply.code(500).send({ error: 'Failed to start live trading', message: error.message });
    }
  });

  // Stop live trading
  fastify.post('/strategies/:id/live/stop', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await liveTrader.stop(id);
      return reply.send({ message: 'Live trading stopped' });
    } catch (error) {
      logger.error({ error }, 'Error stopping live trading');
      return reply.code(500).send({ error: 'Failed to stop live trading' });
    }
  });

  // Get pending live trade
  fastify.get('/strategies/:id/live/pending-trade', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const pendingTrade = liveTrader.getPendingTrade(id);
      if (!pendingTrade) {
        return reply.code(404).send({ error: 'No pending trade' });
      }
      return reply.send(pendingTrade);
    } catch (error) {
      logger.error({ error }, 'Error getting pending trade');
      return reply.code(500).send({ error: 'Failed to get pending trade' });
    }
  });

  // Record completed live trade
  fastify.post('/strategies/:id/live/record-trade', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        symbol: string;
        side: 'BUY' | 'SELL';
        size: number;
        entryPrice: number;
        exitPrice?: number;
        fees: number;
        slippage: number;
        pnl: number;
        pnlPct: number;
        txHash: string;
      };

      await liveTrader.recordTrade(id, body);
      return reply.send({ message: 'Trade recorded' });
    } catch (error) {
      logger.error({ error }, 'Error recording trade');
      return reply.code(500).send({ error: 'Failed to record trade' });
    }
  });

  // Get trades
  fastify.get('/strategies/:id/trades', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { limit = 100, mode } = request.query as { limit?: number; mode?: string };

      const trades = await prisma.trade.findMany({
        where: {
          strategyId: id,
          ...(mode ? { mode } : {}),
        },
        orderBy: { timestamp: 'desc' },
        take: parseInt(limit.toString(), 10),
      });

      return reply.send(trades);
    } catch (error) {
      logger.error({ error }, 'Error getting trades');
      return reply.code(500).send({ error: 'Failed to get trades' });
    }
  });

  // Get performance
  fastify.get('/strategies/:id/performance', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const snapshots = await prisma.performanceSnapshot.findMany({
        where: { strategyId: id },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });

      const trades = await prisma.trade.findMany({
        where: { strategyId: id },
        orderBy: { timestamp: 'desc' },
      });

      const closedTrades = trades.filter((t) => t.exitPrice);
      const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
      const winRate =
        closedTrades.length > 0
          ? closedTrades.filter((t) => t.pnl > 0).length / closedTrades.length
          : 0;

      return reply.send({
        snapshots,
        summary: {
          totalTrades: trades.length,
          totalPnL,
          winRate,
          latestSnapshot: snapshots[0],
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error getting performance');
      return reply.code(500).send({ error: 'Failed to get performance' });
    }
  });

  // Get best strategies (ranked by performance)
  fastify.get('/strategies/best', async (request, reply) => {
    try {
      const { period = 'day', limit = '10' } = request.query as { period?: string; limit?: string };
      const limitNum = parseInt(limit, 10) || 10;

      // Calculate time range
      const now = Date.now();
      let startTime: Date;
      switch (period) {
        case 'day':
          startTime = new Date(now - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(now - 24 * 60 * 60 * 1000);
      }

      // Get all strategies with recent trades
      const strategies = await prisma.strategy.findMany({
        where: {
          status: { in: ['ACTIVE', 'PAUSED'] },
        },
      });

      const strategyPerformance = await Promise.all(
        strategies.map(async (strategy) => {
          const trades = await prisma.trade.findMany({
            where: {
              strategyId: strategy.id,
              timestamp: { gte: startTime },
            },
          });

          const closedTrades = trades.filter((t) => t.exitPrice);
          if (closedTrades.length < 3) {
            // Need at least 3 trades to rank
            return null;
          }

          const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
          const winRate = closedTrades.filter((t) => t.pnl > 0).length / closedTrades.length;
          const avgPnL = totalPnL / closedTrades.length;
          const totalReturnPct = (totalPnL / 10000) * 100; // Assuming 10k starting

          // Calculate score: weighted combination of P&L, win rate, and consistency
          const score =
            totalPnL * 0.5 + // 50% weight on total profit
            winRate * 1000 * 0.3 + // 30% weight on win rate
            (avgPnL > 0 ? avgPnL * 10 : 0) * 0.2; // 20% weight on consistency

          return {
            strategy,
            performance: {
              totalPnL,
              winRate,
              totalTrades: closedTrades.length,
              avgPnL,
              totalReturnPct,
              score,
            },
          };
        })
      );

      // Filter out nulls and sort by score
      const ranked = strategyPerformance
        .filter((sp): sp is NonNullable<typeof sp> => sp !== null)
        .sort((a, b) => b.performance.score - a.performance.score)
        .slice(0, limitNum);

      return reply.send({
        period,
        strategies: ranked.map((sp) => ({
          id: sp.strategy.id,
          name: sp.strategy.name,
          mode: sp.strategy.mode,
          status: sp.strategy.status,
          performance: sp.performance,
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Error getting best strategies');
      return reply.code(500).send({ error: 'Failed to get best strategies' });
    }
  });

  // Get strategy templates
  fastify.get('/strategies/templates', async (request, reply) => {
    try {
      const { category } = request.query as { category?: string };
      
      if (category) {
        const templates = getTemplatesByCategory(category as any);
        return reply.send({ templates });
      }
      
      return reply.send({ templates: STRATEGY_TEMPLATES });
    } catch (error) {
      logger.error({ error }, 'Error getting templates');
      return reply.code(500).send({ error: 'Failed to get templates' });
    }
  });

  // Get single template
  fastify.get('/strategies/templates/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const template = getTemplate(id);
      
      if (!template) {
        return reply.code(404).send({ error: 'Template not found' });
      }
      
      return reply.send({ template });
    } catch (error) {
      logger.error({ error }, 'Error getting template');
      return reply.code(500).send({ error: 'Failed to get template' });
    }
  });

  // Run parameter sweep
  fastify.post('/strategies/sweep', async (request, reply) => {
    try {
      const body = request.body as {
        templateId: string;
        symbol: string;
        timeframe: string;
        days?: number;
        maxVariants?: number;
      };

      const { templateId, symbol, timeframe, days = 30, maxVariants = 20 } = body;

      // Get historical candles
      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;
      
      const candles = await dataFeed.getHistoricalCandles({
        symbol,
        timeframe,
        startTime,
        endTime,
      });

      if (candles.length < 50) {
        return reply.code(400).send({ 
          error: `Not enough historical data. Got ${candles.length} candles, need at least 50.` 
        });
      }

      // Run sweep
      const results = await parameterSweep.runSweep({
        templateId,
        candles,
        initialEquity: 1000,
        maxVariants,
      });

      return reply.send({
        templateId,
        symbol,
        timeframe,
        totalVariants: results.length,
        topResults: results.slice(0, 10), // Top 10
        allResults: results,
      });
    } catch (error) {
      logger.error({ error }, 'Error running parameter sweep');
      return reply.code(500).send({ error: 'Failed to run parameter sweep' });
    }
  });

  // Analyze promotion readiness
  fastify.get('/strategies/:id/promotion', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const analysis = await analyzePromotion(id);
      return reply.send(analysis);
    } catch (error) {
      logger.error({ error }, 'Error analyzing promotion');
      return reply.code(500).send({ error: 'Failed to analyze promotion' });
    }
  });

  // Promote strategy
  fastify.post('/strategies/:id/promote', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { targetStatus: string };
      
      await promoteStrategy(id, body.targetStatus as any);
      return reply.send({ success: true, message: `Strategy promoted to ${body.targetStatus}` });
    } catch (error: any) {
      logger.error({ error }, 'Error promoting strategy');
      return reply.code(400).send({ error: error.message || 'Failed to promote strategy' });
    }
  });

  // Get training metrics and insights
  fastify.get('/strategies/:id/training', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      
      // Get learning insights
      const insights = await predictionTrainer.getLearningInsights(id, 100);
      
      // Get predictions
      const predictions = await prisma.prediction.findMany({
        where: { strategyId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      
      // Calculate improvement over time
      const recentPredictions = predictions.slice(0, 50);
      const olderPredictions = predictions.slice(50, 100);
      
      const recentAccuracy = recentPredictions.filter(p => p.outcome === 'correct').length / Math.max(recentPredictions.length, 1);
      const olderAccuracy = olderPredictions.filter(p => p.outcome === 'correct').length / Math.max(olderPredictions.length, 1);
      
      // Get buy/sell statistics
      const trades = await prisma.trade.findMany({
        where: { strategyId: id },
      });
      
      const buyTrades = trades.filter(t => t.side === 'BUY');
      const sellTrades = trades.filter(t => t.side === 'SELL');
      const buyWinRate = buyTrades.filter(t => t.pnl > 0).length / Math.max(buyTrades.length, 1);
      const sellWinRate = sellTrades.filter(t => t.pnl > 0).length / Math.max(sellTrades.length, 1);
      
      return reply.send({
        accuracy: insights.accuracy,
        totalPredictions: predictions.length,
        evaluatedPredictions: predictions.filter(p => p.evaluatedAt).length,
        improvement: recentPredictions.length > 0 && olderPredictions.length > 0 
          ? ((recentAccuracy - olderAccuracy) * 100).toFixed(1) + '%'
          : 'N/A',
        recentAccuracy: (recentAccuracy * 100).toFixed(1) + '%',
        olderAccuracy: (olderAccuracy * 100).toFixed(1) + '%',
        correctPatterns: insights.correctPatterns,
        incorrectPatterns: insights.incorrectPatterns,
        recommendations: insights.recommendations,
        buySellStats: {
          totalBuys: buyTrades.length,
          totalSells: sellTrades.length,
          buyWinRate: (buyWinRate * 100).toFixed(1) + '%',
          sellWinRate: (sellWinRate * 100).toFixed(1) + '%',
          avgBuyPnl: buyTrades.reduce((sum, t) => sum + t.pnl, 0) / Math.max(buyTrades.length, 1),
          avgSellPnl: sellTrades.reduce((sum, t) => sum + t.pnl, 0) / Math.max(sellTrades.length, 1),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error getting training metrics');
      return reply.code(500).send({ error: 'Failed to get training metrics' });
    }
  });

  // Create limit order
  fastify.post('/strategies/:id/limit-orders', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        symbol: string;
        side: 'BUY' | 'SELL';
        size: number;
        limitPrice: number;
        expiryTime?: string;
      };

      const strategy = await prisma.strategy.findUnique({
        where: { id },
        include: { user: true },
      });

      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found' });
      }

      const order = await limitOrderService.createLimitOrder({
        strategyId: id,
        symbol: body.symbol,
        side: body.side,
        size: body.size,
        limitPrice: body.limitPrice,
        chainId: strategy.chainId,
        expiryTime: body.expiryTime ? new Date(body.expiryTime) : undefined,
      });

      return reply.send({ order });
    } catch (error: any) {
      logger.error({ error }, 'Error creating limit order');
      return reply.code(500).send({ error: error.message || 'Failed to create limit order' });
    }
  });

  // Get pending limit orders
  fastify.get('/strategies/:id/limit-orders', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const orders = await limitOrderService.getPendingOrders(id);
      return reply.send({ orders });
    } catch (error) {
      logger.error({ error }, 'Error getting limit orders');
      return reply.code(500).send({ error: 'Failed to get limit orders' });
    }
  });

  // Cancel limit order
  fastify.delete('/strategies/:id/limit-orders/:orderId', async (request, reply) => {
    try {
      const { orderId } = request.params as { orderId: string };
      await limitOrderService.cancelLimitOrder(orderId);
      return reply.send({ success: true });
    } catch (error: any) {
      logger.error({ error }, 'Error cancelling limit order');
      return reply.code(500).send({ error: error.message || 'Failed to cancel limit order' });
    }
  });

  // Get multi-timeframe analysis
  fastify.get('/strategies/:id/multi-timeframe', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { symbol } = request.query as { symbol?: string };

      const strategy = await prisma.strategy.findUnique({
        where: { id },
      });

      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found' });
      }

      const config: StrategyConfig = JSON.parse(strategy.configJson);
      const targetSymbol = symbol || config.universe[0];

      const analysis = await multiTimeframeAnalyzer.analyze(
        targetSymbol,
        strategy.timeframe,
        strategy.chainId
      );

      return reply.send({ analysis });
    } catch (error) {
      logger.error({ error }, 'Error getting multi-timeframe analysis');
      return reply.code(500).send({ error: 'Failed to get multi-timeframe analysis' });
    }
  });

  // Check MEV risk for a quote
  fastify.post('/strategies/:id/mev-check', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        quote: any;
        currentPrice: number;
      };

      const analysis = mevProtection.analyzeMEVRisk(body.quote, body.currentPrice);
      const isSafe = mevProtection.isTransactionSafe(body.quote);

      return reply.send({
        riskLevel: analysis.riskLevel,
        priceImpact: analysis.priceImpact,
        recommendations: analysis.recommendations,
        isSafe,
      });
    } catch (error) {
      logger.error({ error }, 'Error checking MEV risk');
      return reply.code(500).send({ error: 'Failed to check MEV risk' });
    }
  });

  // Copy Trading Endpoints
  fastify.post('/strategies/:id/copy-targets', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        walletAddress: string;
        chainId: number;
        chainType: 'EVM' | 'SOLANA';
        copyPercentage?: number;
        minConfidence?: number;
      };

      const target = await copyTradingService.addCopyTarget({
        strategyId: id,
        ...body,
      });

      return reply.send({ target });
    } catch (error: any) {
      logger.error({ error }, 'Error adding copy target');
      return reply.code(500).send({ error: error.message || 'Failed to add copy target' });
    }
  });

  fastify.get('/strategies/:id/copy-targets', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const targets = await copyTradingService.getCopyTargets(id);
      return reply.send({ targets });
    } catch (error) {
      logger.error({ error }, 'Error getting copy targets');
      return reply.code(500).send({ error: 'Failed to get copy targets' });
    }
  });

  fastify.delete('/strategies/:id/copy-targets/:targetId', async (request, reply) => {
    try {
      const { targetId } = request.params as { targetId: string };
      await copyTradingService.removeCopyTarget(targetId);
      return reply.send({ success: true });
    } catch (error: any) {
      logger.error({ error }, 'Error removing copy target');
      return reply.code(500).send({ error: error.message || 'Failed to remove copy target' });
    }
  });

  // Portfolio Rebalancing
  fastify.post('/strategies/:id/rebalance', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        targetWeights?: Record<string, number>;
        auto?: boolean;
      };

      if (body.auto) {
        await portfolioRebalancer.autoRebalance(id);
        return reply.send({ success: true, message: 'Auto-rebalance completed' });
      } else if (body.targetWeights) {
        // Get current positions
        const strategy = await prisma.strategy.findUnique({
          where: { id },
        });
        if (!strategy) {
          return reply.code(404).send({ error: 'Strategy not found' });
        }

        const recentTrades = await prisma.trade.findMany({
          where: { strategyId: id },
          orderBy: { timestamp: 'desc' },
          take: 100,
        });

        // Calculate positions (simplified)
        const positions: any[] = [];
        let totalValue = 10000;

        const plan = await portfolioRebalancer.calculateRebalancePlan(
          id,
          body.targetWeights,
          positions,
          totalValue
        );

        return reply.send({ plan });
      } else {
        return reply.code(400).send({ error: 'Either auto=true or targetWeights required' });
      }
    } catch (error: any) {
      logger.error({ error }, 'Error rebalancing portfolio');
      return reply.code(500).send({ error: error.message || 'Failed to rebalance' });
    }
  });

  // Advanced Training Endpoints
  fastify.get('/strategies/:id/advanced-training', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const metrics = await advancedTrainer.analyzePredictions(id);
      return reply.send({ metrics });
    } catch (error: any) {
      logger.error({ error }, 'Error getting advanced training metrics');
      return reply.code(500).send({ error: error.message || 'Failed to get training metrics' });
    }
  });

  fastify.get('/strategies/:id/model-insights', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const insights = await advancedTrainer.generateModelInsights(id);
      return reply.send({ insights });
    } catch (error: any) {
      logger.error({ error }, 'Error generating model insights');
      return reply.code(500).send({ error: error.message || 'Failed to generate insights' });
    }
  });

  fastify.post('/strategies/:id/train', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await advancedTrainer.continuousTraining(id);
      return reply.send({ success: true, message: 'Training completed' });
    } catch (error: any) {
      logger.error({ error }, 'Error running training');
      return reply.code(500).send({ error: error.message || 'Failed to run training' });
    }
  });

  // Cleanup test strategies
  fastify.post('/strategies/cleanup', async (request, reply) => {
    try {
      logger.info('Starting strategy cleanup...');
      await cleanupTestStrategies();
      return reply.send({ success: true, message: 'Cleanup completed' });
    } catch (error: any) {
      logger.error({ error }, 'Error during cleanup');
      return reply.code(500).send({ error: error.message || 'Failed to cleanup strategies' });
    }
  });

  // Generate research-based Solana strategies
  fastify.post('/strategies/generate-solana', async (request, reply) => {
    try {
      const { count = 5 } = request.body as { count?: number };
      const { solanaStrategyGenerator } = await import('../services/solanaStrategyGenerator');
      const strategyIds = await solanaStrategyGenerator.generateSolanaStrategies(count);
      return reply.send({ 
        success: true, 
        message: `Generated ${strategyIds.length} research-based Solana strategies`,
        strategyIds 
      });
    } catch (error: any) {
      logger.error({ error }, 'Error generating Solana strategies');
      return reply.code(500).send({ error: error.message || 'Failed to generate Solana strategies' });
    }
  });

  // Generate new AI-powered strategies
  fastify.post('/strategies/generate', async (request, reply) => {
    try {
      const body = request.body as { count?: number };
      const count = body.count || 5;

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
      }

      logger.info({ count, userId: user.id }, 'Generating strategies...');
      const strategyIds = await generateAndCreateStrategies(count);

      return reply.send({
        success: true,
        message: `Generated ${strategyIds.length} strategies`,
        strategyIds,
      });
    } catch (error: any) {
      logger.error({ error }, 'Error generating strategies');
      return reply.code(500).send({ error: error.message || 'Failed to generate strategies' });
    }
  });
}
