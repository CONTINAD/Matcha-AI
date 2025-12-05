import { logger } from '../config/logger';

export interface RecoveryOptions {
  maxRestarts?: number;
  restartWindowMs?: number; // Time window for counting restarts
  fallbackToCache?: boolean;
  gracefulDegradation?: boolean;
}

interface RestartRecord {
  timestamp: number;
  error: string;
}

/**
 * Auto-Recovery Service
 * 
 * Provides automatic recovery from errors with:
 * - Auto-restart on crash (with rate limiting)
 * - Fallback to cached data if API fails
 * - Graceful degradation (continue with limited features)
 */
export class RecoveryService {
  private restartHistory: Map<string, RestartRecord[]> = new Map(); // strategyId -> restart records
  private readonly DEFAULT_MAX_RESTARTS = 3;
  private readonly DEFAULT_RESTART_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Check if we can restart a strategy
   * Returns true if restart is allowed, false if too many restarts
   */
  canRestart(strategyId: string, options: RecoveryOptions = {}): boolean {
    const maxRestarts = options.maxRestarts || this.DEFAULT_MAX_RESTARTS;
    const restartWindow = options.restartWindowMs || this.DEFAULT_RESTART_WINDOW_MS;
    const now = Date.now();

    const history = this.restartHistory.get(strategyId) || [];
    
    // Filter to only recent restarts (within window)
    const recentRestarts = history.filter(
      (record) => now - record.timestamp < restartWindow
    );

    // Update history
    this.restartHistory.set(strategyId, recentRestarts);

    if (recentRestarts.length >= maxRestarts) {
      logger.warn(
        {
          strategyId,
          restarts: recentRestarts.length,
          maxRestarts,
          window: restartWindow,
          lastRestart: recentRestarts[recentRestarts.length - 1]?.timestamp,
        },
        `Too many restarts for strategy ${strategyId}, blocking restart`
      );
      return false;
    }

    return true;
  }

  /**
   * Record a restart attempt
   */
  recordRestart(strategyId: string, error: Error): void {
    const history = this.restartHistory.get(strategyId) || [];
    history.push({
      timestamp: Date.now(),
      error: error.message,
    });
    this.restartHistory.set(strategyId, history);

    logger.info(
      {
        strategyId,
        error: error.message,
        totalRestarts: history.length,
      },
      `Recorded restart for strategy ${strategyId}`
    );
  }

  /**
   * Attempt to recover from an error
   * Returns recovery action: 'restart' | 'fallback' | 'degrade' | 'fail'
   */
  async attemptRecovery(
    strategyId: string,
    error: Error,
    options: RecoveryOptions = {}
  ): Promise<'restart' | 'fallback' | 'degrade' | 'fail'> {
    const errorMessage = error.message.toLowerCase();

    // Check if error is recoverable
    const isRecoverable =
      errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('503') ||
      errorMessage.includes('502') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('temporarily unavailable');

    if (!isRecoverable) {
      logger.error(
        {
          strategyId,
          error: error.message,
        },
        'Error is not recoverable, failing'
      );
      return 'fail';
    }

    // Try restart if allowed
    if (this.canRestart(strategyId, options)) {
      this.recordRestart(strategyId, error);
      logger.info(
        {
          strategyId,
          error: error.message,
        },
        'Attempting restart recovery'
      );
      return 'restart';
    }

    // Try fallback to cache if enabled
    if (options.fallbackToCache) {
      logger.info(
        {
          strategyId,
          error: error.message,
        },
        'Attempting cache fallback recovery'
      );
      return 'fallback';
    }

    // Try graceful degradation if enabled
    if (options.gracefulDegradation) {
      logger.info(
        {
          strategyId,
          error: error.message,
        },
        'Attempting graceful degradation recovery'
      );
      return 'degrade';
    }

    // No recovery options available
    logger.error(
      {
        strategyId,
        error: error.message,
      },
      'No recovery options available, failing'
    );
    return 'fail';
  }

  /**
   * Clear restart history for a strategy
   * Useful when strategy is manually stopped/restarted
   */
  clearHistory(strategyId: string): void {
    this.restartHistory.delete(strategyId);
    logger.debug({ strategyId }, 'Cleared restart history');
  }

  /**
   * Get restart statistics for a strategy
   */
  getRestartStats(strategyId: string): {
    totalRestarts: number;
    recentRestarts: number;
    lastRestart?: number;
    canRestart: boolean;
  } {
    const history = this.restartHistory.get(strategyId) || [];
    const now = Date.now();
    const recentRestarts = history.filter(
      (record) => now - record.timestamp < this.DEFAULT_RESTART_WINDOW_MS
    );

    return {
      totalRestarts: history.length,
      recentRestarts: recentRestarts.length,
      lastRestart: history[history.length - 1]?.timestamp,
      canRestart: recentRestarts.length < this.DEFAULT_MAX_RESTARTS,
    };
  }

  /**
   * Wrap a function with auto-recovery
   * Automatically retries on recoverable errors
   */
  async withRecovery<T>(
    strategyId: string,
    fn: () => Promise<T>,
    options: RecoveryOptions = {}
  ): Promise<T> {
    const maxAttempts = (options.maxRestarts || this.DEFAULT_MAX_RESTARTS) + 1; // +1 for initial attempt
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If this is the last attempt, throw
        if (attempt === maxAttempts - 1) {
          logger.error(
            {
              strategyId,
              attempt: attempt + 1,
              maxAttempts,
              error: lastError.message,
            },
            'All recovery attempts failed'
          );
          throw lastError;
        }

        // Check if we can recover
        const recoveryAction = await this.attemptRecovery(strategyId, lastError, options);

        if (recoveryAction === 'fail') {
          throw lastError;
        }

        // Wait before retry (exponential backoff)
        const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        logger.warn(
          {
            strategyId,
            attempt: attempt + 1,
            maxAttempts,
            delay,
            recoveryAction,
            error: lastError.message,
          },
          `Recovery attempt ${attempt + 1}, retrying in ${delay}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Recovery failed');
  }
}

export const recoveryService = new RecoveryService();

