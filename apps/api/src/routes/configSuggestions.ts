import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { matchaBrain } from '../services/matchaBrain';
import type { StrategyConfig } from '@matcha-ai/shared';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export async function configSuggestionRoutes(fastify: FastifyInstance) {
  // Get config suggestions for a strategy
  fastify.get('/strategies/:id/config-suggestions', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const suggestions = await prisma.configSuggestion.findMany({
        where: { strategyId: id },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send(suggestions);
    } catch (error) {
      logger.error({ error }, 'Error getting config suggestions');
      return reply.code(500).send({ error: 'Failed to get config suggestions' });
    }
  });

  // Accept a config suggestion
  fastify.post('/strategies/:id/config-suggestions/:suggestionId/accept', async (request, reply) => {
    try {
      const { id, suggestionId } = request.params as { id: string; suggestionId: string };

      const suggestion = await prisma.configSuggestion.findUnique({
        where: { id: suggestionId },
      });

      if (!suggestion || suggestion.strategyId !== id) {
        return reply.code(404).send({ error: 'Suggestion not found' });
      }

      if (suggestion.status !== 'PENDING') {
        return reply.code(400).send({ error: 'Suggestion already processed' });
      }

      // Update strategy config
      await prisma.strategy.update({
        where: { id },
        data: {
          configJson: suggestion.suggestedConfigJson,
        },
      });

      // Update suggestion status
      await prisma.configSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'ACCEPTED',
        },
      });

      return reply.send({ message: 'Suggestion accepted' });
    } catch (error) {
      logger.error({ error }, 'Error accepting suggestion');
      return reply.code(500).send({ error: 'Failed to accept suggestion' });
    }
  });

  // Reject a config suggestion
  fastify.post('/strategies/:id/config-suggestions/:suggestionId/reject', async (request, reply) => {
    try {
      const { id, suggestionId } = request.params as { id: string; suggestionId: string };

      const suggestion = await prisma.configSuggestion.findUnique({
        where: { id: suggestionId },
      });

      if (!suggestion || suggestion.strategyId !== id) {
        return reply.code(404).send({ error: 'Suggestion not found' });
      }

      if (suggestion.status !== 'PENDING') {
        return reply.code(400).send({ error: 'Suggestion already processed' });
      }

      await prisma.configSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'REJECTED',
        },
      });

      return reply.send({ message: 'Suggestion rejected' });
    } catch (error) {
      logger.error({ error }, 'Error rejecting suggestion');
      return reply.code(500).send({ error: 'Failed to reject suggestion' });
    }
  });
}

