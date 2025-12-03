import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/env';
import { logger } from './config/logger';
import { strategyRoutes } from './routes/strategies';
import { configSuggestionRoutes } from './routes/configSuggestions';
import { healthRoutes } from './routes/health';
import { walletRoutes } from './routes/wallets';
import { wsService } from './services/websocket';
import { autoTrainingScheduler } from './jobs/autoTrainingScheduler';

const server = Fastify({
  logger: logger.child({ component: 'api' }),
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

// Routes
server.register(healthRoutes);
server.register(strategyRoutes);
server.register(configSuggestionRoutes);
server.register(walletRoutes);

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
  } catch (error) {
    logger.error({ error }, 'Error starting server');
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  autoTrainingScheduler.stop();
  wsService.stop();
  server.close();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  autoTrainingScheduler.stop();
  wsService.stop();
  server.close();
});

start();

