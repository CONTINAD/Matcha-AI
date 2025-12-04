import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../config/logger';

/**
 * Comprehensive error handler middleware
 * Provides structured error responses with proper HTTP status codes
 */
export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Log error with correlation ID
  const correlationId = request.id || `req-${Date.now()}`;
  logger.error({
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    correlationId,
    method: request.method,
    url: request.url,
    statusCode: error.statusCode || 500,
  }, 'Request error');

  // Determine status code
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal server error';

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation error: ' + error.message;
  } else if (error.name === 'UnauthorizedError' || error.message.includes('unauthorized')) {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (error.message.includes('not found')) {
    statusCode = 404;
  } else if (error.message.includes('timeout')) {
    statusCode = 504;
    message = 'Request timeout';
  } else if (error.message.includes('rate limit')) {
    statusCode = 429;
    message = 'Rate limit exceeded';
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
  }

  // Send error response
  reply.code(statusCode).send({
    error: {
      message,
      correlationId,
      statusCode,
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack,
        name: error.name,
      }),
    },
  });
}

/**
 * Health check for external services
 */
export async function checkServiceHealth(service: string): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  const start = Date.now();
  try {
    switch (service) {
      case 'database':
        // Check database connection
        const { prisma } = await import('../config/database');
        await prisma.$queryRaw`SELECT 1`;
        return { healthy: true, latency: Date.now() - start };
      
      case 'redis':
        // Check Redis if available
        const { config } = await import('../config/env');
        if (config.dataProviders.cache.redisUrl) {
          const Redis = (await import('ioredis')).default;
          const redis = new Redis(config.dataProviders.cache.redisUrl);
          await redis.ping();
          redis.disconnect();
          return { healthy: true, latency: Date.now() - start };
        }
        return { healthy: true, latency: 0 }; // Redis optional
    
      case 'openai':
        // Check OpenAI API
        const { config: openaiConfig } = await import('../config/env');
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: openaiConfig.openai.apiKey });
        // Simple check - list models (lightweight)
        await openai.models.list();
        return { healthy: true, latency: Date.now() - start };
      
      default:
        return { healthy: false, error: `Unknown service: ${service}` };
    }
  } catch (error: any) {
    return {
      healthy: false,
      latency: Date.now() - start,
      error: error.message || 'Service check failed',
    };
  }
}

/**
 * Retry logic with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        logger.warn({ attempt: attempt + 1, maxRetries, delay, error: lastError.message }, 'Retrying with exponential backoff');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Retry failed');
}

