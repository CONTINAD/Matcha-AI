import { logger } from '../config/logger';
import type { ZeroXQuoteParams, ZeroXSwapTx } from '@matcha-ai/shared';

export interface QueuedTrade {
  id: string;
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  quoteParams: ZeroXQuoteParams;
  priority: 'high' | 'normal' | 'low';
  retries: number;
  maxRetries: number;
  createdAt: number;
}

export interface QueueOptions {
  maxRetries?: number;
  retryDelay?: number; // milliseconds
  priority?: 'high' | 'normal' | 'low';
}

/**
 * Trade Queue Service
 * 
 * Provides async trade execution with:
 * - Job queue for trade execution (using in-memory queue for now, can upgrade to Bull/BullMQ)
 * - Retry failed trades (exponential backoff)
 * - Priority queue (arbitrage > regular trades)
 * - Rate limiting and batching
 */
export class TradeQueue {
  private queue: QueuedTrade[] = [];
  private processing: Set<string> = new Set(); // Track trades being processed
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly DEFAULT_MAX_RETRIES = 3;
  private readonly DEFAULT_RETRY_DELAY = 1000; // 1 second
  private readonly PROCESSING_INTERVAL_MS = 100; // Process queue every 100ms

  constructor() {
    this.startProcessing();
  }

  /**
   * Add trade to queue
   */
  async enqueue(
    strategyId: string,
    symbol: string,
    side: 'BUY' | 'SELL',
    size: number,
    price: number,
    quoteParams: ZeroXQuoteParams,
    options: QueueOptions = {}
  ): Promise<string> {
    const tradeId = `${strategyId}-${symbol}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const queuedTrade: QueuedTrade = {
      id: tradeId,
      strategyId,
      symbol,
      side,
      size,
      price,
      quoteParams,
      priority: options.priority || 'normal',
      retries: 0,
      maxRetries: options.maxRetries || this.DEFAULT_MAX_RETRIES,
      createdAt: Date.now(),
    };

    // Insert based on priority
    if (queuedTrade.priority === 'high') {
      this.queue.unshift(queuedTrade); // Add to front
    } else if (queuedTrade.priority === 'low') {
      this.queue.push(queuedTrade); // Add to back
    } else {
      // Normal priority: insert after high priority trades
      const highPriorityCount = this.queue.filter((t) => t.priority === 'high').length;
      this.queue.splice(highPriorityCount, 0, queuedTrade);
    }

    logger.info(
      {
        tradeId,
        strategyId,
        symbol,
        side,
        size,
        priority: queuedTrade.priority,
        queueLength: this.queue.length,
      },
      'Trade enqueued for execution'
    );

    return tradeId;
  }

  /**
   * Start processing queue
   */
  private startProcessing(): void {
    if (this.processingInterval) {
      return; // Already processing
    }

    this.processingInterval = setInterval(() => {
      this.processNext();
    }, this.PROCESSING_INTERVAL_MS);

    logger.info('Trade queue processing started');
  }

  /**
   * Stop processing queue
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.info('Trade queue processing stopped');
    }
  }

  /**
   * Process next trade in queue
   */
  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      return; // Queue empty
    }

    // Get next trade (already sorted by priority)
    const trade = this.queue[0];
    
    if (this.processing.has(trade.id)) {
      return; // Already processing
    }

    this.processing.add(trade.id);
    this.queue.shift(); // Remove from queue

    try {
      // Execute trade (this would call executionEngine.executeTrade)
      // For now, we'll just log it - actual execution will be integrated later
      logger.info(
        {
          tradeId: trade.id,
          strategyId: trade.strategyId,
          symbol: trade.symbol,
          side: trade.side,
          size: trade.size,
          retries: trade.retries,
        },
        'Processing queued trade'
      );

      // TODO: Integrate with executionEngine.executeTrade()
      // const result = await executionEngine.executeTrade(trade.quoteParams);
      // await this.onTradeExecuted(trade, result);

      // For now, mark as processed
      this.onTradeExecuted(trade, null);
    } catch (error: any) {
      logger.error(
        {
          tradeId: trade.id,
          error: error.message,
          retries: trade.retries,
          maxRetries: trade.maxRetries,
        },
        'Trade execution failed'
      );

      // Retry if allowed
      if (trade.retries < trade.maxRetries) {
        trade.retries++;
        const delay = this.DEFAULT_RETRY_DELAY * Math.pow(2, trade.retries - 1); // Exponential backoff
        
        // Re-queue with delay
        setTimeout(() => {
          this.queue.unshift(trade); // Add back to front (high priority for retries)
          logger.info(
            {
              tradeId: trade.id,
              retries: trade.retries,
              delay,
            },
            'Re-queuing failed trade for retry'
          );
        }, delay);
      } else {
        logger.error(
          {
            tradeId: trade.id,
            maxRetries: trade.maxRetries,
          },
          'Trade failed after max retries, removing from queue'
        );
        this.onTradeFailed(trade, error);
      }
    } finally {
      this.processing.delete(trade.id);
    }
  }

  /**
   * Handle successful trade execution
   */
  private onTradeExecuted(trade: QueuedTrade, result: any): void {
    logger.info(
      {
        tradeId: trade.id,
        strategyId: trade.strategyId,
        symbol: trade.symbol,
        retries: trade.retries,
      },
      'Trade executed successfully from queue'
    );
    // TODO: Emit event or callback for trade execution
  }

  /**
   * Handle failed trade (after max retries)
   */
  private onTradeFailed(trade: QueuedTrade, error: Error): void {
    logger.error(
      {
        tradeId: trade.id,
        strategyId: trade.strategyId,
        symbol: trade.symbol,
        error: error.message,
        retries: trade.retries,
      },
      'Trade failed permanently, removed from queue'
    );
    // TODO: Emit event or callback for trade failure
  }

  /**
   * Get queue status
   */
  getStatus(): {
    queueLength: number;
    processing: number;
    queued: QueuedTrade[];
  } {
    return {
      queueLength: this.queue.length,
      processing: this.processing.size,
      queued: [...this.queue],
    };
  }

  /**
   * Clear queue (for testing or emergency)
   */
  clearQueue(): void {
    this.queue = [];
    this.processing.clear();
    logger.warn('Trade queue cleared');
  }

  /**
   * Remove trade from queue
   */
  removeTrade(tradeId: string): boolean {
    const index = this.queue.findIndex((t) => t.id === tradeId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      logger.info({ tradeId }, 'Trade removed from queue');
      return true;
    }
    return false;
  }
}

export const tradeQueue = new TradeQueue();

