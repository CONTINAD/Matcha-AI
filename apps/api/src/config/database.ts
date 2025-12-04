import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

/**
 * Shared Prisma client instance with connection pooling
 * Prisma automatically manages connection pooling, but using a singleton
 * ensures we don't create multiple instances
 */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  errorFormat: 'pretty',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Add query timeout middleware
prisma.$use(async (params, next) => {
  const timeout = 30000; // 30 seconds default timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Query timeout after ${timeout}ms`)), timeout);
  });

  try {
    const result = await Promise.race([next(params), timeoutPromise]);
    return result;
  } catch (error) {
    logger.error({ error, model: params.model, action: params.action }, 'Database query error or timeout');
    throw error;
  }
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  logger.info('Database connection closed');
});

