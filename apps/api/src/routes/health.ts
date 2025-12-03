import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { metricsRegistry, renderPrometheusMetrics } from '../services/metrics';

const prisma = new PrismaClient();

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request, reply) => {
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;

      return reply.send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return reply.code(503).send({
        status: 'unhealthy',
        error: 'Database connection failed',
      });
    }
  });

  fastify.get('/metrics', async (request, reply) => {
    try {
      const activeStrategies = await prisma.strategy.count({
        where: { status: 'ACTIVE' },
      });

      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tradesLast24h = await prisma.trade.count({
        where: {
          timestamp: {
            gte: last24h,
          },
        },
      });

      return reply.send({
        activeStrategies,
        tradesLast24h,
        uptime: process.uptime(),
      });
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to get metrics' });
    }
  });

  fastify.get('/metrics/prom', async (request, reply) => {
    try {
      const body = await renderPrometheusMetrics();
      reply.header('Content-Type', metricsRegistry.contentType);
      return reply.send(body);
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to render metrics' });
    }
  });
}
