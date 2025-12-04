import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/env';
import { logger } from './config/logger';
import { strategyRoutes } from './routes/strategies';
import { configSuggestionRoutes } from './routes/configSuggestions';
import { healthRoutes } from './routes/health';
import { walletRoutes } from './routes/wallets';
import { testingRoutes } from './routes/testing';
import { analyticsRoutes } from './routes/analytics';
import { wsService } from './services/websocket';
import { autoTrainingScheduler } from './jobs/autoTrainingScheduler';
import { errorHandler } from './middleware/errorHandler';

const server = Fastify({
  logger: logger.child({ component: 'api' }),
  bodyLimit: 1048576, // 1MB
});

// Allow empty JSON body
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    const json = body === '' ? {} : JSON.parse(body as string);
    done(null, json);
  } catch (err) {
    done(err as Error, undefined);
  }
});


// Handle OPTIONS requests globally (CORS preflight)
server.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS') {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return reply.code(200).send();
  }
});

// CORS headers for all requests
server.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
});

// Error handler
server.setErrorHandler(errorHandler);

// Routes
server.register(healthRoutes);
server.register(strategyRoutes);
server.register(configSuggestionRoutes);
server.register(walletRoutes);
server.register(testingRoutes);
server.register(analyticsRoutes);

// Start server
const start = async () => {
  try {
    // Register rate limiting
    await server.register(rateLimit, {
      max: 100, // 100 requests
      timeWindow: '1 minute', // per minute
      keyGenerator: (request) => {
        // Use IP address as key
        return request.ip || request.socket.remoteAddress || 'unknown';
      },
      allowList: ['127.0.0.1', '::1'], // Allow localhost
      errorResponseBuilder: (request, context) => {
        return {
          error: 'Rate limit exceeded',
          message: `Too many requests. Limit: ${context.max} per minute`,
          retryAfter: Math.ceil(context.ttl / 1000),
        };
      },
    });
    logger.info('Rate limiting enabled (100 req/min)');

    await server.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info({ port: config.server.port }, 'API server started');
    
    // Start WebSocket server
    const wsPort = (config.server.port || 4000) + 1;
    wsService.start(wsPort);
    logger.info({ port: wsPort }, 'WebSocket server started');
    
    // Start auto-training scheduler (trains strategies every 10 minutes)
    autoTrainingScheduler.start();
    logger.info('Auto-training scheduler started');
    
    // Auto-start paper trading for all ACTIVE strategies in PAPER mode
    try {
      const { paperTrader } = await import('./services/paperTrader');
      const { prisma } = await import('./config/database');
      
      const activeStrategies = await prisma.strategy.findMany({
        where: { status: 'ACTIVE', mode: 'PAPER' },
      });
      
      logger.info({ count: activeStrategies.length }, 'Auto-starting paper trading for active strategies');
      
      for (const strategy of activeStrategies) {
        try {
          // Check if already running
          if (!paperTrader.isActive(strategy.id)) {
            await paperTrader.start(strategy.id);
            logger.info({ strategyId: strategy.id, name: strategy.name }, '✅ Auto-started paper trading');
          }
        } catch (error: any) {
          logger.warn({ error: error.message, strategyId: strategy.id }, '⚠️  Failed to auto-start paper trading');
        }
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to auto-start paper trading (non-critical)');
    }
  } catch (error) {
    logger.error({ error }, 'Error starting server');
    process.exit(1);
  }
};

// Graceful shutdown with proper cleanup
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`);
  
  // Stop accepting new requests
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Stop background services
  autoTrainingScheduler.stop();
  wsService.stop();
  
  // Give connections time to close (max 10 seconds)
  const shutdownTimeout = setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  
  // Wait for all connections to close
  try {
    // Close database connections if needed
    await new Promise((resolve) => {
      setTimeout(resolve, 1000); // Give 1 second for cleanup
    });
    clearTimeout(shutdownTimeout);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();

