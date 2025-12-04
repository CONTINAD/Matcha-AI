import { FastifyInstance } from 'fastify';
import { analyticsService } from '../services/analyticsService';
import { tradeAnalyticsService } from '../services/tradeAnalyticsService';
import { logger } from '../config/logger';

export async function analyticsRoutes(fastify: FastifyInstance) {
  /**
   * GET /analytics/trades
   * Get trade analytics for a time range
   * Query params: strategyIds (comma-separated), fromTime, toTime
   */
  fastify.get('/analytics/trades', async (request, reply) => {
    try {
      const query = request.query as {
        strategyIds?: string;
        fromTime?: string;
        toTime?: string;
      };

      const strategyIds = query.strategyIds ? query.strategyIds.split(',') : undefined;
      const fromTime = query.fromTime ? parseInt(query.fromTime, 10) : undefined;
      const toTime = query.toTime ? parseInt(query.toTime, 10) : undefined;

      const data = await analyticsService.getTradeAnalytics(strategyIds, fromTime, toTime);

      return reply.code(200).send(data);
    } catch (error) {
      logger.error({ error }, 'Error fetching trade analytics');
      return reply.code(500).send({
        error: 'Failed to fetch trade analytics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /analytics/execution-quality
   * Get execution quality metrics
   * Query params: strategyId, fromTime, toTime
   */
  fastify.get('/analytics/execution-quality', async (request, reply) => {
    try {
      const query = request.query as {
        strategyId?: string;
        fromTime?: string;
        toTime?: string;
      };

      const strategyId = query.strategyId;
      const fromTime = query.fromTime ? parseInt(query.fromTime, 10) : undefined;
      const toTime = query.toTime ? parseInt(query.toTime, 10) : undefined;

      const data = await analyticsService.getExecutionQualityMetrics(strategyId, fromTime, toTime);

      return reply.code(200).send(data);
    } catch (error) {
      logger.error({ error }, 'Error fetching execution quality metrics');
      return reply.code(500).send({
        error: 'Failed to fetch execution quality metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /analytics/performance
   * Get performance metrics
   * Query params: strategyId, fromTime, toTime
   */
  fastify.get('/analytics/performance', async (request, reply) => {
    try {
      const query = request.query as {
        strategyId?: string;
        fromTime?: string;
        toTime?: string;
      };

      const strategyId = query.strategyId;
      const fromTime = query.fromTime ? parseInt(query.fromTime, 10) : undefined;
      const toTime = query.toTime ? parseInt(query.toTime, 10) : undefined;

      const data = await analyticsService.getPerformanceMetrics(strategyId, fromTime, toTime);

      return reply.code(200).send(data);
    } catch (error) {
      logger.error({ error }, 'Error fetching performance metrics');
      return reply.code(500).send({
        error: 'Failed to fetch performance metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /analytics/strategy/:id
   * Get comprehensive analytics for a specific strategy
   * Query params: fromTime, toTime
   */
  fastify.get('/analytics/strategy/:id', async (request, reply) => {
    try {
      const params = request.params as { id: string };
      const query = request.query as {
        fromTime?: string;
        toTime?: string;
      };

      const strategyId = params.id;
      const fromTime = query.fromTime ? parseInt(query.fromTime, 10) : undefined;
      const toTime = query.toTime ? parseInt(query.toTime, 10) : undefined;

      const data = await analyticsService.getStrategyAnalytics(strategyId, fromTime, toTime);

      return reply.code(200).send(data);
    } catch (error) {
      logger.error({ error }, 'Error fetching strategy analytics');
      return reply.code(500).send({
        error: 'Failed to fetch strategy analytics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /analytics/trade/:tradeId
   * Get analytics for a specific trade
   */
  fastify.get('/analytics/trade/:tradeId', async (request, reply) => {
    try {
      const params = request.params as { tradeId: string };
      const tradeId = params.tradeId;

      const data = await tradeAnalyticsService.getTradeAnalytics(tradeId);

      if (!data) {
        return reply.code(404).send({
          error: 'Trade analytics not found',
          message: `No analytics data found for trade ${tradeId}`,
        });
      }

      return reply.code(200).send(data);
    } catch (error) {
      logger.error({ error }, 'Error fetching trade analytics');
      return reply.code(500).send({
        error: 'Failed to fetch trade analytics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /analytics/strategy/:id/trades
   * Get trade analytics for a specific strategy
   * Query params: limit
   */
  fastify.get('/analytics/strategy/:id/trades', async (request, reply) => {
    try {
      const params = request.params as { id: string };
      const query = request.query as {
        limit?: string;
      };

      const strategyId = params.id;
      const limit = query.limit ? parseInt(query.limit, 10) : 100;

      const data = await tradeAnalyticsService.getStrategyAnalytics(strategyId, limit);

      return reply.code(200).send(data);
    } catch (error) {
      logger.error({ error }, 'Error fetching strategy trade analytics');
      return reply.code(500).send({
        error: 'Failed to fetch strategy trade analytics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}

