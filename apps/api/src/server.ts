import Fastify from 'fastify';
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

