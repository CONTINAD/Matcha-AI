import { FastifyInstance } from 'fastify';
import { walletService } from '../services/walletService';
import { logger } from '../config/logger';

export async function walletRoutes(fastify: FastifyInstance) {
  // Connect wallet (EVM or Solana) - NON-CUSTODIAL: Only stores public info
  fastify.post('/wallets/connect', async (request, reply) => {
    try {
      const body = request.body as {
        userId?: string;
        chainType: 'EVM' | 'SOLANA';
        address: string;
        chainId?: number;
        maxTradingAmount?: number;
        label?: string; // Optional label for the wallet
      };

      // Validate address format
      if (!body.address || body.address.length < 20) {
        return reply.code(400).send({
          error: 'Invalid wallet address',
        });
      }

      // Get or create default user
      let userId = body.userId;
      if (!userId) {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        let user = await prisma.user.findUnique({
          where: { email: 'default-user@matcha.ai' },
        });
        if (!user) {
          user = await prisma.user.create({
            data: { email: 'default-user@matcha.ai' },
          });
        }
        userId = user.id;
      }

      const wallet = await walletService.connectWallet(
        userId,
        body.chainType,
        body.address,
        body.chainId,
        body.maxTradingAmount,
        body.label
      );

      return reply.code(201).send({
        id: wallet.id,
        address: wallet.address,
        chainType: wallet.chainType,
        chainId: wallet.chainId,
        maxTradingAmount: wallet.maxTradingAmount,
        isActive: wallet.isActive,
        label: wallet.label,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error connecting wallet');
      return reply.code(400).send({
        error: 'Failed to connect wallet',
        message: error.message,
      });
    }
  });

  // Get wallet balance
  fastify.get('/wallets/:id/balance', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { token } = request.query as { token?: string };

      // This would query blockchain for balance
      // For now, return placeholder
      return reply.send({
        balance: 0,
        token: token || 'USDC',
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error getting balance');
      return reply.code(500).send({ error: 'Failed to get balance' });
    }
  });

  // List user wallets
  fastify.get('/wallets', async (request, reply) => {
    try {
      const { userId } = request.query as { userId?: string };
      if (!userId) {
        return reply.code(400).send({ error: 'userId is required' });
      }

      const wallets = await walletService.getWallets(userId);
      return reply.send(
        wallets.map((w) => ({
          id: w.id,
          address: w.address,
          chainType: w.chainType,
          chainId: w.chainId,
          maxTradingAmount: w.maxTradingAmount,
          isActive: w.isActive,
          label: w.label,
          createdAt: w.createdAt,
        }))
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error listing wallets');
      return reply.code(500).send({ error: 'Failed to list wallets' });
    }
  });

  // Disconnect wallet
  fastify.post('/wallets/:id/disconnect', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { userId } = request.body as { userId: string };
      if (!userId) {
        return reply.code(400).send({ error: 'userId is required' });
      }

      await walletService.disconnectWallet(id, userId);
      return reply.send({ message: 'Wallet disconnected' });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error disconnecting wallet');
      return reply.code(500).send({ error: error.message || 'Failed to disconnect wallet' });
    }
  });
}

